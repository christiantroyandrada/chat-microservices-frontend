#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/chat-app}"
DEPLOY_PATH="$DEPLOY_ROOT/chat-microservices"
COMPOSE_FILE="$DEPLOY_PATH/frontend.compose.yml"
STATE_FILE="$DEPLOY_ROOT/release-state.env"
LOCK_FILE="$DEPLOY_ROOT/.release.lock"
IMAGE_REF="${IMAGE_REF:-${1:-}}"
REPO_OWNER="${REPO_OWNER:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-60}"
HEALTH_POLL_SECONDS="${HEALTH_POLL_SECONDS:-2}"

die() {
	echo "deploy-frontend: $*" >&2
	exit 1
}

is_immutable_frontend_ref() {
	[[ "$1" =~ ^ghcr\.io/$REPO_OWNER/chat-frontend@sha256:[0-9a-fA-F]{64}$ ]]
}

[[ -n "$IMAGE_REF" ]] || die 'IMAGE_REF is required'
[[ "$REPO_OWNER" =~ ^[A-Za-z0-9_.-]+$ ]] || die 'REPO_OWNER is required and must be a valid GHCR owner'
is_immutable_frontend_ref "$IMAGE_REF" || die "invalid immutable frontend image ref: $IMAGE_REF"
[[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || die 'HEALTH_TIMEOUT_SECONDS must be a non-negative integer'
[[ "$HEALTH_POLL_SECONDS" =~ ^[0-9]+$ ]] || die 'HEALTH_POLL_SECONDS must be a non-negative integer'
[[ -d "$DEPLOY_ROOT" ]] || die "deployment root does not exist: $DEPLOY_ROOT"
command -v flock >/dev/null 2>&1 || die 'flock is required for serialized releases'

exec 9>"$LOCK_FILE"
flock -x 9

[[ -d "$DEPLOY_PATH" ]] || die "deployment directory does not exist: $DEPLOY_PATH"

temporary_compose=''
temporary_state=''
cleanup() {
	if [[ -n "$temporary_compose" ]] && [[ -e "$temporary_compose" ]]; then
		rm -f -- "$temporary_compose"
	fi
	if [[ -n "$temporary_state" ]] && [[ -e "$temporary_state" ]]; then
		rm -f -- "$temporary_state"
	fi
}
trap cleanup EXIT

write_compose() {
	temporary_compose="$(mktemp "$DEPLOY_PATH/.frontend.compose.yml.XXXXXX")"
	printf '%s\n' \
		'services:' \
		'  frontend:' \
		'    image: ${FRONTEND_IMAGE:?FRONTEND_IMAGE is required}' \
		'    restart: unless-stopped' \
		'    environment:' \
		'      NODE_ENV: production' \
		'      PORT: 3000' \
		'      HOST: 0.0.0.0' \
		'      ORIGIN: https://chat.ctaprojects.xyz' \
		'      PROTOCOL_HEADER: x-forwarded-proto' \
		'      HOST_HEADER: x-forwarded-host' \
		'      PUBLIC_API_URL: https://chat.ctaprojects.xyz' \
		'      PUBLIC_WS_URL: https://chat.ctaprojects.xyz' \
		'    expose:' \
		'      - "3000"' \
		'    healthcheck:' \
		'      test: ["CMD", "/nodejs/bin/node", "-e", "require(\"http\").get(\"http://127.0.0.1:3000/\", (response) => process.exit(response.statusCode >= 200 && response.statusCode < 400 ? 0 : 1)).on(\"error\", () => process.exit(1))"]' \
		'      interval: 10s' \
		'      timeout: 3s' \
		'      retries: 6' \
		'    networks:' \
		'      - chat-microservices_default' \
		'networks:' \
		'  chat-microservices_default:' \
		'    external: true' \
		'    name: chat-microservices_default' > "$temporary_compose"
	mv -f -- "$temporary_compose" "$COMPOSE_FILE"
	temporary_compose=''
}

write_compose

frontend_current=''
frontend_previous=''
if [[ -f "$STATE_FILE" ]]; then
	while IFS= read -r line || [[ -n "$line" ]]; do
		case "$line" in
			frontend.current=*) frontend_current="${line#frontend.current=}" ;;
			frontend.previous=*) frontend_previous="${line#frontend.previous=}" ;;
		esac
	done < "$STATE_FILE"
fi

if [[ -n "$frontend_current" ]] && ! is_immutable_frontend_ref "$frontend_current"; then
	die "release state contains an invalid frontend.current ref"
fi
if [[ -n "$frontend_previous" ]] && ! is_immutable_frontend_ref "$frontend_previous"; then
	die "release state contains an invalid frontend.previous ref"
fi

prepare_state() {
	local current="$1"
	local previous="$2"
	temporary_state="$(mktemp "$DEPLOY_ROOT/.release-state.env.XXXXXX")"
	if [[ -f "$STATE_FILE" ]]; then
		awk -v current="$current" -v previous="$previous" '
			BEGIN { current_seen = 0; previous_seen = 0 }
			/^frontend\.current=/ {
				if (!current_seen) print "frontend.current=" current
				current_seen = 1
				next
			}
			/^frontend\.previous=/ {
				if (!previous_seen && previous != "") print "frontend.previous=" previous
				previous_seen = 1
				next
			}
			{ print }
			END {
				if (!current_seen) print "frontend.current=" current
				if (!previous_seen && previous != "") print "frontend.previous=" previous
			}
		' "$STATE_FILE" > "$temporary_state"
	else
		printf 'frontend.current=%s\n' "$current" > "$temporary_state"
		if [[ -n "$previous" ]]; then
			printf 'frontend.previous=%s\n' "$previous" >> "$temporary_state"
		fi
	fi
	if [[ "${DEPLOY_TEST_FAIL_BEFORE_RENAME:-0}" == '1' ]]; then
		die 'injected failure before release-state rename'
	fi
}

commit_state() {
	if [[ "${DEPLOY_TEST_FAIL_BEFORE_COMMIT:-0}" == '1' ]]; then
		die 'injected failure before release-state commit'
	fi
	mv -f -- "$temporary_state" "$STATE_FILE"
	temporary_state=''
}

write_state() {
	prepare_state "$1" "$2"
	commit_state
}

docker_compose() {
	FRONTEND_IMAGE="$IMAGE_REF" docker compose -f "$COMPOSE_FILE" -p chat-microservices "$@"
}

wait_for_frontend() {
	local expected_ref="$1"
	local elapsed=0
	local container_id=''
	local status=''
	local runtime_image=''
	while (( elapsed <= HEALTH_TIMEOUT_SECONDS )); do
		container_id="$(docker_compose ps -q frontend 2>/dev/null || true)"
		if [[ -n "$container_id" ]]; then
			status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
			if [[ "$status" == 'healthy' ]]; then
				runtime_image="$(EXPECTED_IMAGE_REF="$expected_ref" docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
				if [[ "$runtime_image" == "$expected_ref" ]]; then
					return 0
				fi
			fi
		fi
		if (( elapsed == HEALTH_TIMEOUT_SECONDS )); then
			break
		fi
		if (( HEALTH_POLL_SECONDS > 0 )); then
			sleep "$HEALTH_POLL_SECONDS"
		fi
		if (( HEALTH_POLL_SECONDS > 0 )); then
			(( elapsed += HEALTH_POLL_SECONDS ))
		else
			(( elapsed += 1 ))
		fi
	done
	return 1
}

rollback_frontend() {
	local rollback_ref="$1"
	[[ -n "$rollback_ref" ]] || die 'frontend health check failed and no previous immutable release is recorded'
	echo "deploy-frontend: health check failed; rolling back to $rollback_ref" >&2
	docker pull "$rollback_ref"
	docker image inspect "$rollback_ref" >/dev/null
	prepare_state "$rollback_ref" "$frontend_previous"
	if ! FRONTEND_IMAGE="$rollback_ref" docker compose -f "$COMPOSE_FILE" -p chat-microservices up -d --no-deps --force-recreate frontend; then
		rm -f -- "$temporary_state"
		temporary_state=''
		die "rollback container replacement failed"
	fi
	if ! wait_for_frontend "$rollback_ref"; then
		rm -f -- "$temporary_state"
		temporary_state=''
		die 'rollback health or runtime-image validation failed'
	fi
	commit_state
	die "frontend release rolled back to $rollback_ref"
}

if [[ "$frontend_current" == "$IMAGE_REF" ]]; then
	# Reconcile compose/env changes without rotating release state or pulling an image.
	if ! docker_compose up -d --no-deps frontend; then
		rollback_frontend "$frontend_previous"
	fi
	if wait_for_frontend "$IMAGE_REF"; then
		echo "deploy-frontend: $IMAGE_REF is already reconciled"
		exit 0
	fi
	# A stale container can survive an otherwise idempotent compose up; bound recovery to one recreate.
	if ! docker_compose up -d --no-deps --force-recreate frontend; then
		rollback_frontend "$frontend_previous"
	fi
	if ! wait_for_frontend "$IMAGE_REF"; then
		rollback_frontend "$frontend_previous"
	fi
	echo "deploy-frontend: reconciled $IMAGE_REF"
	exit 0
fi

if [[ -n "${GHCR_TOKEN:-}" ]]; then
	printf '%s\n' "$GHCR_TOKEN" | docker login ghcr.io --username "${REPO_OWNER:-}" --password-stdin >/dev/null
fi

docker pull "$IMAGE_REF"
docker image inspect "$IMAGE_REF" >/dev/null

prepare_state "$IMAGE_REF" "$frontend_current"
if ! docker_compose up -d --no-deps --force-recreate frontend; then
	rm -f -- "$temporary_state"
	temporary_state=''
	if [[ -n "$frontend_current" ]]; then
		rollback_frontend "$frontend_current"
	else
		die "frontend container replacement failed and no previous release is recorded"
	fi
fi

if wait_for_frontend "$IMAGE_REF"; then
	if ! commit_state; then
		rm -f -- "$temporary_state"
		temporary_state=''
		if [[ -n "$frontend_current" ]]; then
			echo "deploy-frontend: state commit failed after health verification; rolling back to $frontend_current" >&2
			prepare_state "$frontend_current" "$frontend_previous"
			if ! FRONTEND_IMAGE="$frontend_current" docker compose -f "$COMPOSE_FILE" -p chat-microservices up -d --no-deps --force-recreate frontend; then
				rm -f -- "$temporary_state"
				temporary_state=''
				die "state commit failed and rollback container replacement failed"
			fi
			if ! wait_for_frontend "$frontend_current"; then
				rm -f -- "$temporary_state"
				temporary_state=''
				die "state commit failed and rollback health failed"
			fi
			commit_state
			die "state commit failed after health verification; rolled back to $frontend_current"
		else
			docker compose -f "$COMPOSE_FILE" -p chat-microservices rm -f -s frontend 2>/dev/null || true
			docker rm -f chat-microservices-frontend-1 2>/dev/null || true
			die "state commit failed after health verification and no previous release; unrecorded runtime removed"
		fi
	fi
	echo "deploy-frontend: deployed $IMAGE_REF"
	exit 0
fi

rm -f -- "$temporary_state"
temporary_state=''
rollback_frontend "$frontend_current"
