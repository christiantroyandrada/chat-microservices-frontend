import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import yaml from 'js-yaml';

const root = resolve(import.meta.dirname, '../..');
const workflowPath = resolve(root, '.github/workflows/ci-main.yml');
const deployPath = resolve(root, 'scripts/deploy-frontend.sh');
const temporaryRoots = [];

function temporaryRoot() {
	const path = mkdtempSync(join(tmpdir(), 'frontend-release-'));
	temporaryRoots.push(path);
	return path;
}

function writeExecutable(path, source) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, source);
	chmodSync(path, 0o755);
}

function fakeMv(
	binDir,
	deployRoot,
	failPattern = '.release-state.env.',
	failOnCounts = [1],
	onFailure = ''
) {
	const countFile = join(deployRoot, '.fake-mv-count');
	writeExecutable(
		join(binDir, 'mv'),
		`#!/bin/sh
if printf '%s' "$*" | grep -q "${failPattern}"; then
  count=$(cat "${countFile}" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "${countFile}"
  case " ${failOnCounts.join(' ')} " in *" $count "*)
    ${onFailure}
    echo "fake mv: injected failure for $* (count $count)" >&2
    exit 1 ;;
  esac
fi
exec /bin/mv "$@"
`
	);
	return countFile;
}

function fakeDocker(binDir, logPath, health = 'healthy') {
	const runtimeImagePath = join(dirname(logPath), 'runtime-image');
	const frontendIdPath = join(dirname(logPath), 'frontend-id');
	writeExecutable(join(binDir, 'flock'), '#!/bin/sh\nexit 0\n');
	writeExecutable(
		join(binDir, 'docker'),
		`#!/bin/sh
set -eu
printf '%s FRONTEND_IMAGE=%s\\n' "$*" "\${FRONTEND_IMAGE:-}" >> "$FAKE_DOCKER_LOG"
if [ "$1" = pull ]; then
  [ "$2" = "\${FAKE_MISSING_IMAGE:-}" ] && exit 44
  exit 0
fi
if [ "$1" = image ] && [ "$2" = inspect ]; then
  [ "$3" = "\${FAKE_MISSING_IMAGE:-}" ] && exit 44
  exit 0
fi
if [ "$1" = rm ]; then
	  if [ "\${FAKE_DOCKER_RM_FAIL:-0}" = "1" ]; then
	    echo 'fake docker: injected rm failure' >&2
	    exit 43
	  fi
  if [ -n "\${FAKE_RUNTIME_IMAGE_FILE:-}" ]; then
    rm -f "\${FAKE_RUNTIME_IMAGE_FILE}"
  fi
	  if [ -n "\${FAKE_FRONTEND_ID_FILE:-}" ]; then
	    rm -f "\${FAKE_FRONTEND_ID_FILE}"
	  fi
  exit 0
fi
if [ "$1" = compose ]; then
  if [ "\${FAKE_COMPOSE_FORCE_RECREATE_FAIL:-0}" = "1" ]; then
    case "$*" in *force-recreate*)
      if [ -z "\${FAKE_COMPOSE_FAIL_IMAGE:-}" ] || [ "\${FRONTEND_IMAGE:-}" = "\${FAKE_COMPOSE_FAIL_IMAGE}" ]; then
        if [ -n "\${FAKE_RUNTIME_IMAGE_FILE:-}" ]; then
          printf '%s\n' "\${FRONTEND_IMAGE:-}" > "\${FAKE_RUNTIME_IMAGE_FILE}"
          if [ -n "\${FAKE_FRONTEND_ID_FILE:-}" ]; then printf '%s\n' candidate-frontend-id > "\${FAKE_FRONTEND_ID_FILE}"; fi
        fi
        exit 42
      fi
      ;;
    esac
  fi
  case "$*" in
    *" ps "*"-q frontend"*)
      if [ -n "\${FAKE_RUNTIME_IMAGE_FILE:-}" ] && [ -f "\${FAKE_RUNTIME_IMAGE_FILE}" ]; then
        if [ "\${FAKE_STOPPED_CANDIDATE:-0}" != "1" ] || printf '%s' "$*" | grep -q -- '--all'; then
          if [ -n "\${FAKE_FRONTEND_ID_FILE:-}" ] && [ -f "\${FAKE_FRONTEND_ID_FILE}" ]; then cat "\${FAKE_FRONTEND_ID_FILE}"; else printf 'fake-frontend-id\\n'; fi
        fi
      fi
      exit 0 ;;
    *" rm "*)
      if [ -n "\${FAKE_RUNTIME_IMAGE_FILE:-}" ]; then
        rm -f "\${FAKE_RUNTIME_IMAGE_FILE}"
      fi
      exit 0 ;;
	  *" up "*)
      if [ -n "\${FAKE_RUNTIME_IMAGE_FILE:-}" ]; then
        case "$*" in
		  *force-recreate*)
            printf '%s\\n' "\${FRONTEND_IMAGE:-}" > "$FAKE_RUNTIME_IMAGE_FILE"
            if [ -n "\${FAKE_FRONTEND_ID_FILE:-}" ]; then printf '%s\\n' candidate-frontend-id > "$FAKE_FRONTEND_ID_FILE"; fi ;;
        esac
      fi
      exit 0 ;;
    *" ps "*) printf '%s\\n' 'frontend running'; exit 0 ;;
  esac
fi
if [ "$1" = inspect ]; then
  case "$*" in
    *"Config.Image"*)
	      if [ -n "\${FAKE_RUNTIME_IMAGE_FILE:-}" ] && [ -f "$FAKE_RUNTIME_IMAGE_FILE" ]; then
	        cat "$FAKE_RUNTIME_IMAGE_FILE"
	      elif [ -n "\${FAKE_RUNTIME_IMAGE:-}" ]; then printf '%s\\n' "\${FAKE_RUNTIME_IMAGE}"; fi ;;
    *) printf '%s\\n' "$FAKE_HEALTH" ;;
  esac
  exit 0
fi
exit 0
`
	);
	return {
		FAKE_DOCKER_LOG: logPath,
		FAKE_HEALTH: health,
		FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
		FAKE_FRONTEND_ID_FILE: frontendIdPath
	};
}

function runDeploy(env, args = []) {
	return spawnSync('bash', [deployPath, ...args], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, REPO_OWNER: 'acme', ...env }
	});
}

function runDeployAsync(env) {
	return new Promise((resolve) => {
		const child = spawn('bash', [deployPath], {
			cwd: root,
			env: { ...process.env, REPO_OWNER: 'acme', ...env }
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('close', (status) => resolve({ status, stdout, stderr }));
	});
}

afterEach(() => {
	for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

const hasFlock = !spawnSync('flock', ['--help'], { encoding: 'utf8' }).error;

describe('frontend immutable deployment workflow', () => {
	it('publishes the build digest and passes only that immutable ref to deployment', () => {
		const workflow = yaml.load(readFileSync(workflowPath, 'utf8'));
		const dockerBuild = workflow.jobs['docker-build'];
		const build = dockerBuild.steps.find((step) => step.id === 'build-image');
		const deploy = workflow.jobs.deploy;
		const deployText = readFileSync(workflowPath, 'utf8').split('  deploy:')[1];

		assert.ok(build);
		assert.ok(dockerBuild.outputs?.frontend_digest.includes('steps.build-image.outputs.digest'));
		assert.strictEqual(deploy.needs, 'docker-build');
		assert.ok(deploy.steps.some((step) => step.with?.script_path === 'scripts/deploy-frontend.sh'));
		assert.ok(
			deployText.includes('chat-frontend@${{ needs.docker-build.outputs.frontend_digest }}')
		);
		assert.doesNotMatch(deployText, /IMAGE_TAG/);
		const buildAndTest = workflow.jobs['build-and-test'];
		const installIndex = buildAndTest.steps.findIndex((step) =>
			step.run?.includes('pnpm install --frozen-lockfile')
		);
		const deploymentTestIndex = buildAndTest.steps.findIndex(
			(step) => step.run === 'node --test scripts/__tests__/deployment-workflow.test.mjs'
		);
		assert.ok(deploymentTestIndex > installIndex);
	});

	it('keeps production deployment immutable and frontend-owned', () => {
		const workflow = readFileSync(workflowPath, 'utf8');
		const script = readFileSync(deployPath, 'utf8');

		assert.match(script, /ghcr\\.io\/[^/]+\/chat-frontend@sha256/);
		assert.doesNotMatch(
			script,
			/latest|docker image prune|docker container prune|docker system prune/
		);
		assert.doesNotMatch(
			script,
			/docker compose[^\n]*--no-deps\s+(postgres|user|chat|notification|nginx)(?:\s|$)/
		);
		assert.doesNotMatch(script, /wget/);
		for (const runtimeKey of [
			'NODE_ENV: production',
			'PORT: 3000',
			'HOST: 0.0.0.0',
			'ORIGIN: https://chat.ctaprojects.xyz',
			'PROTOCOL_HEADER: x-forwarded-proto',
			'HOST_HEADER: x-forwarded-host',
			'PUBLIC_API_URL: https://chat.ctaprojects.xyz',
			'PUBLIC_WS_URL: https://chat.ctaprojects.xyz',
			'expose:',
			'- "3000"'
		]) {
			assert.ok(script.includes(runtimeKey));
		}
		assert.ok(script.includes('frontend.compose.yml'));
		assert.ok(script.includes('LOCK_FILE="$DEPLOY_ROOT/.release.lock"'));
		assert.ok(script.includes('STATE_FILE="$DEPLOY_ROOT/release-state.env"'));
		assert.ok(workflow.includes('actions/checkout@'));
	});

	it('rejects an invalid immutable ref before any docker mutation', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		writeFileSync(logPath, '');
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(join(deployRoot, 'release-state.env'), 'frontend.current=\n');

		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: 'ghcr.io/acme/chat-frontend:latest'
		});

		assert.notStrictEqual(result.status, 0);
		assert.strictEqual(readFileSync(logPath, 'utf8'), '');
	});

	it('rejects a repository-mismatched owner before any docker mutation', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		writeFileSync(logPath, '');
		mkdirSync(join(deployRoot, 'chat-microservices'));

		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			REPO_OWNER: 'acme',
			IMAGE_REF: `ghcr.io/other/chat-frontend@sha256:${'a'.repeat(64)}`
		});

		assert.notStrictEqual(result.status, 0);
		assert.strictEqual(readFileSync(logPath, 'utf8'), '');
	});

	it('rejects a repository-mismatched stored state before any docker mutation', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		writeFileSync(logPath, '');
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=ghcr.io/other/chat-frontend@sha256:${'b'.repeat(64)}\n`
		);

		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			REPO_OWNER: 'acme',
			IMAGE_REF: `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`
		});

		assert.notStrictEqual(result.status, 0);
		assert.strictEqual(readFileSync(logPath, 'utf8'), '');
	});

	it('serializes state, preserves unowned keys, and rolls back the exact previous digest', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`backend.current=ghcr.io/acme/chat@${'c'.repeat(40)}\nfrontend.current=${oldRef}\nfrontend.previous=ghcr.io/acme/chat-frontend@sha256:${'d'.repeat(64)}\nowner.custom=keep\n`
		);

		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '1',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.strictEqual(result.status, 0);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.ok(state.includes(`frontend.current=${newRef}`));
		assert.ok(state.includes(`frontend.previous=${oldRef}`));
		assert.ok(state.includes('backend.current='));
		assert.ok(state.includes('owner.custom=keep'));
		assert.ok(readFileSync(logPath, 'utf8').includes('compose -f'));
	});

	it('fails closed when the health check fails without a recorded previous release', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath, 'unhealthy');
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(
			join(deployRoot, 'chat-microservices/frontend.compose.yml'),
			'services:\n  frontend: {}\n'
		);
		writeFileSync(join(deployRoot, 'release-state.env'), 'owner.custom=keep\n');

		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr + result.stdout, /previous/i);
		assert.ok(
			readFileSync(join(deployRoot, 'release-state.env'), 'utf8').includes('owner.custom=keep')
		);
	});

	it('rolls back to the exact recorded digest after a health failure', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath, 'healthy');
		writeExecutable(
			join(binDir, 'docker'),
			`#!/bin/sh
set -eu
printf '%s FRONTEND_IMAGE=%s\\n' "$*" "\${FRONTEND_IMAGE:-}" >> "$FAKE_DOCKER_LOG"
if [ "$1" = inspect ]; then
  case "$*" in
    *Config.Image*) printf '%s\\n' "$EXPECTED_IMAGE_REF"; exit 0 ;;
  esac
	  count="$(cat "$FAKE_HEALTH_COUNT" 2>/dev/null || printf 0)"
	  count=$((count + 1))
	  printf '%s' "$count" > "$FAKE_HEALTH_COUNT"
	  [ "$count" -ge 2 ] && printf 'healthy\\n' || printf 'unhealthy\\n'
  exit 0
fi
	if [ "$1" = compose ] && printf '%s' "$*" | grep -q 'ps -q frontend'; then printf 'fake-frontend-id\\n'; fi
exit 0
`
		);
		const healthCount = join(deployRoot, 'health-count');
		writeFileSync(healthCount, '0');
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(
			join(deployRoot, 'chat-microservices/frontend.compose.yml'),
			'services:\n  frontend: {}\n'
		);
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${oldRef}\nowner.custom=keep\n`
		);

		const result = runDeploy({
			...fakeEnv,
			FAKE_HEALTH_COUNT: healthCount,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.ok(state.includes(`frontend.current=${oldRef}`));
		assert.ok(
			!state.includes(`frontend.previous=${newRef}`),
			`previous must not be failed candidate, got: ${state}`
		);
		assert.ok(
			!state.includes('frontend.previous='),
			`previous should remain absent, got: ${state}`
		);
		const dockerLog = readFileSync(logPath, 'utf8');
		assert.ok(dockerLog.includes(`pull ${newRef}`));
		assert.doesNotMatch(dockerLog, new RegExp(`pull ${oldRef}`));
		assert.ok(
			dockerLog.includes('up -d --no-deps --force-recreate frontend FRONTEND_IMAGE=' + oldRef)
		);
	});

	it('leaves prior state bytes intact when atomic rename is injected to fail', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldState = 'frontend.current=\nowner.custom=keep\n';
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(logPath, '');
		writeFileSync(join(deployRoot, 'release-state.env'), oldState);

		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`,
			DEPLOY_TEST_FAIL_BEFORE_RENAME: '1'
		});

		assert.notStrictEqual(result.status, 0);
		assert.strictEqual(readFileSync(join(deployRoot, 'release-state.env'), 'utf8'), oldState);
		assert.doesNotMatch(readFileSync(logPath, 'utf8'), /compose/);
		assert.deepStrictEqual(
			readdirSync(deployRoot).filter((name) => name.startsWith('.release-state.env.')),
			[]
		);
	});

	it('reconciles compose config for an already-current healthy digest without rotating state', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const image = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const oldState = `frontend.current=${image}\nfrontend.previous=ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}\nowner.custom=keep\n`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(
			join(deployRoot, 'chat-microservices/frontend.compose.yml'),
			'services:\n  frontend:\n    image: stale\n'
		);
		writeFileSync(join(deployRoot, 'release-state.env'), oldState);
		writeFileSync(fakeEnv.FAKE_RUNTIME_IMAGE_FILE, image + '\n');

		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: image,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.strictEqual(result.status, 0);
		assert.strictEqual(readFileSync(join(deployRoot, 'release-state.env'), 'utf8'), oldState);
		const dockerLog = readFileSync(logPath, 'utf8');
		assert.match(dockerLog, /compose .* up -d --no-deps frontend/);
		assert.doesNotMatch(dockerLog, /pull|force-recreate/);
		assert.match(
			readFileSync(join(deployRoot, 'chat-microservices/frontend.compose.yml'), 'utf8'),
			/image: \$\{FRONTEND_IMAGE:\?FRONTEND_IMAGE is required\}/
		);
	});

	it('reconciles a healthy container whose image drifted from current state', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldImage = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const currentImage = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		const oldState = `frontend.current=${currentImage}\nfrontend.previous=${oldImage}\nowner.custom=keep\n`;
		writeFileSync(join(deployRoot, 'release-state.env'), oldState);
		writeFileSync(runtimeImagePath, oldImage + '\n');

		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: currentImage,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.strictEqual(result.status, 0);
		assert.strictEqual(readFileSync(join(deployRoot, 'release-state.env'), 'utf8'), oldState);
		const dockerLog = readFileSync(logPath, 'utf8');
		assert.ok(dockerLog.includes('up -d --no-deps frontend'));
		assert.ok(dockerLog.includes('up -d --no-deps --force-recreate frontend'));
		assert.doesNotMatch(dockerLog, /pull/);
	});

	it('rolls back an interrupted retry to the recorded previous digest', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const targetRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		writeExecutable(
			join(binDir, 'docker'),
			`#!/bin/sh
set -eu
printf '%s FRONTEND_IMAGE=%s\\n' "$*" "\${FRONTEND_IMAGE:-}" >> "$FAKE_DOCKER_LOG"
if [ "$1" = pull ] || { [ "$1" = image ] && [ "$2" = inspect ]; }; then exit 0; fi
if [ "$1" = compose ]; then
  case "$*" in
    *" ps -q frontend"*) printf 'fake-frontend-id\\n'; exit 0 ;;
    *" up "*)
      case "$*" in *force-recreate*) printf '%s\\n' "\${FRONTEND_IMAGE:-}" > "$FAKE_RUNTIME_IMAGE_FILE" ;; esac
      exit 0 ;;
  esac
fi
if [ "$1" = inspect ]; then
  case "$*" in
    *Config.Image*) cat "$FAKE_RUNTIME_IMAGE_FILE" ;;
    *)
	      if [ "$(cat "$FAKE_RUNTIME_IMAGE_FILE")" = "$TARGET_REF" ]; then printf 'unhealthy\\n'; else printf 'healthy\\n'; fi
      ;;
  esac
  exit 0
fi
exit 0
`
		);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, targetRef + '\n');
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${targetRef}\nfrontend.previous=${oldRef}\nowner.custom=keep\n`
		);

		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			TARGET_REF: targetRef,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: targetRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		assert.strictEqual(readFileSync(runtimeImagePath, 'utf8'), oldRef + '\n');
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.ok(state.includes(`frontend.current=${oldRef}`));
		assert.ok(
			!state.includes(`frontend.previous=${targetRef}`),
			`previous must not be failed candidate, got: ${state}`
		);
		assert.ok(state.includes('owner.custom=keep'));
		const dockerLog = readFileSync(logPath, 'utf8');
		assert.doesNotMatch(dockerLog, new RegExp(`pull ${oldRef}`));
		assert.ok(
			dockerLog.includes(`up -d --no-deps --force-recreate frontend FRONTEND_IMAGE=${oldRef}`)
		);
	});

	it('rolls back an interrupted retry when compose reconciliation fails', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const targetRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		writeExecutable(
			join(binDir, 'docker'),
			`#!/bin/sh
set -eu
printf '%s FRONTEND_IMAGE=%s\\n' "$*" "\${FRONTEND_IMAGE:-}" >> "$FAKE_DOCKER_LOG"
if [ "$1" = pull ] || { [ "$1" = image ] && [ "$2" = inspect ]; }; then exit 0; fi
if [ "$1" = compose ]; then
  case "$*" in
    *" ps -q frontend"*) printf 'fake-frontend-id\\n'; exit 0 ;;
    *" up "*)
      if [ "\${FRONTEND_IMAGE:-}" = "$TARGET_REF" ]; then exit 42; fi
      printf '%s\\n' "\${FRONTEND_IMAGE:-}" > "$FAKE_RUNTIME_IMAGE_FILE"
      exit 0 ;;
  esac
fi
if [ "$1" = inspect ]; then
  case "$*" in
    *Config.Image*) cat "$FAKE_RUNTIME_IMAGE_FILE" ;;
    *) printf 'healthy\\n' ;;
  esac
  exit 0
fi
exit 0
`
		);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, targetRef + '\n');
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${targetRef}\nfrontend.previous=${oldRef}\nowner.custom=keep\n`
		);

		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			TARGET_REF: targetRef,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: targetRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		assert.strictEqual(readFileSync(runtimeImagePath, 'utf8'), oldRef + '\n');
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.ok(state.includes(`frontend.current=${oldRef}`));
		assert.ok(
			!state.includes(`frontend.previous=${targetRef}`),
			`previous must not be failed candidate, got: ${state}`
		);
		assert.ok(state.includes('owner.custom=keep'));
	});

	it('does not advance release state when container replacement fails', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, oldRef + '\n');
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${oldRef}\nowner.custom=keep\n`
		);

		const result = runDeploy({
			...fakeEnv,
			FAKE_COMPOSE_FORCE_RECREATE_FAIL: '1',
			FAKE_COMPOSE_FAIL_IMAGE: newRef,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.ok(
			state.includes(`frontend.current=${oldRef}`),
			`state should remain old, got: ${state}`
		);
		assert.ok(
			!state.includes(`frontend.current=${newRef}`),
			`current should not be new, got: ${state}`
		);
		assert.ok(state.includes('owner.custom=keep'));
		assert.strictEqual(readFileSync(runtimeImagePath, 'utf8'), oldRef + '\n');
		const dockerLog = readFileSync(logPath, 'utf8');
		assert.ok(dockerLog.includes(`pull ${newRef}`));
		// Bounded rollback: should have attempted to restore previous
		assert.ok(dockerLog.includes(`force-recreate frontend FRONTEND_IMAGE=${oldRef}`));
	});

	it('leaves original state unchanged when initial deployment with no previous fails', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		// No state file initially (absent)
		const result = runDeploy({
			...fakeEnv,
			FAKE_COMPOSE_FORCE_RECREATE_FAIL: '1',
			FAKE_COMPOSE_FAIL_IMAGE: newRef,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.notStrictEqual(result.status, 0);
		const statePath = join(deployRoot, 'release-state.env');
		assert.ok(
			!existsSync(statePath) || !readFileSync(statePath, 'utf8').includes(newRef),
			`state should remain absent or without new, got: ${existsSync(statePath) ? readFileSync(statePath, 'utf8') : 'absent'}`
		);
		assert.ok(!readFileSync(logPath, 'utf8').includes('rollback'));
		assert.ok(readFileSync(logPath, 'utf8').includes(`pull ${newRef}`));
	});

	it('preserves last known-good state when both new and rollback replacements fail', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		const oldState = `frontend.current=${oldRef}\nowner.custom=keep\n`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, oldRef + '\n');
		writeFileSync(join(deployRoot, 'release-state.env'), oldState);
		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			FAKE_COMPOSE_FORCE_RECREATE_FAIL: '1',
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.notStrictEqual(result.status, 0);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.strictEqual(state, oldState, `state should remain exactly original, got: ${state}`);
		const runtime = readFileSync(runtimeImagePath, 'utf8').trim();
		assert.strictEqual(
			runtime,
			oldRef,
			`runtime should remain old after both failures, got: ${runtime}`
		);
		const log2 = readFileSync(logPath, 'utf8');
		const pullNewCount = (log2.match(new RegExp(`pull ${newRef}`, 'g')) || []).length;
		const pullOldCount = (log2.match(new RegExp(`pull ${oldRef}`, 'g')) || []).length;
		assert.strictEqual(pullNewCount, 1, 'new pull should be bounded to one');
		assert.strictEqual(pullOldCount, 0, 'cached rollback image should not be pulled');
	});

	it('leaves original state unchanged when new runtime is healthy but state commit fails', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, oldRef + '\n');
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${oldRef}\nowner.custom=keep\n`
		);
		fakeMv(binDir, deployRoot);
		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.notStrictEqual(result.status, 0);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.ok(
			state.includes(`frontend.current=${oldRef}`),
			`state should remain old, got: ${state}`
		);
		assert.ok(
			!state.includes(`frontend.current=${newRef}`),
			`state should not be new, got: ${state}`
		);
	});

	it('rolls back to last verified image when new commit fails after health', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, oldRef + '\n');
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${oldRef}\nowner.custom=keep\n`
		);
		fakeMv(binDir, deployRoot);
		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.notStrictEqual(result.status, 0);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		const runtime = readFileSync(runtimeImagePath, 'utf8').trim();
		assert.ok(
			state.includes(`frontend.current=${oldRef}`),
			`state should remain old, got: ${state}`
		);
		assert.strictEqual(runtime, oldRef, `runtime should be rolled back to old, got: ${runtime}`);
		const log = readFileSync(logPath, 'utf8');
		const pullNewIdx = log.indexOf(`pull ${newRef}`);
		const pullOldIdx = log.indexOf(`pull ${oldRef}`);
		const upNewIdx = log.indexOf(
			`up -d --no-deps --force-recreate frontend FRONTEND_IMAGE=${newRef}`
		);
		const upOldIdx = log.indexOf(
			`up -d --no-deps --force-recreate frontend FRONTEND_IMAGE=${oldRef}`
		);
		assert.ok(pullNewIdx !== -1 && upNewIdx !== -1, 'should have pulled and up new');
		assert.strictEqual(pullOldIdx, -1, 'cached rollback image should not be pulled');
		assert.ok(upOldIdx > upNewIdx, 'rollback up should be after new up');
		const upOldCount = (
			log.match(
				new RegExp(`up -d --no-deps --force-recreate frontend FRONTEND_IMAGE=${oldRef}`, 'g')
			) || []
		).length;
		assert.strictEqual(upOldCount, 1, 'rollback should be bounded to one attempt');
	});

	it('removes unrecorded new runtime when initial commit fails with no previous', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, 'initial\n');
		// No state file
		fakeMv(binDir, deployRoot);
		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.notStrictEqual(result.status, 0);
		const statePath = join(deployRoot, 'release-state.env');
		assert.ok(!existsSync(statePath) || !readFileSync(statePath, 'utf8').includes(newRef));
		const runtime = existsSync(runtimeImagePath)
			? readFileSync(runtimeImagePath, 'utf8').trim()
			: '';
		assert.ok(
			runtime !== newRef,
			`runtime should not remain new after failed initial commit, got: ${runtime}`
		);
		const log = readFileSync(logPath, 'utf8');
		assert.ok(log.includes(`pull ${newRef}`));
		assert.ok(
			log.includes('rm -f candidate-frontend-id'),
			'should have cleaned up exact unrecorded runtime'
		);
		const rmCount = (log.match(/rm -f candidate-frontend-id/g) || []).length;
		assert.strictEqual(rmCount, 1, 'cleanup should be bounded to one attempt');
		assert.ok(
			!existsSync(runtimeImagePath) || readFileSync(runtimeImagePath, 'utf8').trim() === '',
			'runtime should be absent after cleanup'
		);
	});

	it('never stores failed candidate as previous after rollback', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const prevRef = `ghcr.io/acme/chat-frontend@sha256:${'c'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, oldRef + '\n');
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${oldRef}\nfrontend.previous=${prevRef}\nowner.custom=keep\n`
		);
		// Make new health fail, so rollback to old
		writeFileSync(
			join(binDir, 'docker'),
			`#!/bin/sh
set -eu
printf '%s FRONTEND_IMAGE=%s\\n' "$*" "\${FRONTEND_IMAGE:-}" >> "$FAKE_DOCKER_LOG"
if [ "$1" = pull ] || { [ "$1" = image ] && [ "$2" = inspect ]; }; then exit 0; fi
if [ "$1" = compose ]; then
  case "$*" in
    *" ps -q frontend"*) printf 'fake-frontend-id\\n'; exit 0 ;;
    *" up "*)
      case "$*" in *force-recreate*) printf '%s\\n' "\${FRONTEND_IMAGE:-}" > "$FAKE_RUNTIME_IMAGE_FILE" ;; esac
      exit 0 ;;
  esac
fi
if [ "$1" = inspect ]; then
  case "$*" in
    *Config.Image*) cat "$FAKE_RUNTIME_IMAGE_FILE" ;;
    *) if [ "$(cat "$FAKE_RUNTIME_IMAGE_FILE")" = "${newRef}" ]; then printf 'unhealthy\\n'; else printf 'healthy\\n'; fi ;;
  esac
  exit 0
fi
exit 0
`
		);
		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.notStrictEqual(result.status, 0);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.ok(state.includes(`frontend.current=${oldRef}`));
		assert.ok(
			!state.includes(`frontend.previous=${newRef}`),
			`previous must not be failed candidate, got: ${state}`
		);
		assert.ok(
			state.includes(`frontend.previous=${prevRef}`) || !state.includes('frontend.previous='),
			`previous should remain prior fallback or absent, got: ${state}`
		);
		// Retry with old should still succeed and not select failed candidate
		const retryResult = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: oldRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.strictEqual(retryResult.status, 0);
	});

	it('fails when state commit mv fails for real', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${oldRef}\nowner.custom=keep\n`
		);
		writeExecutable(
			join(binDir, 'mv'),
			`#!/bin/sh
if printf '%s' "$*" | grep -q ".release-state.env."; then
  echo "fake mv: injected failure for $*" >&2
  exit 1
fi
exec /bin/mv "$@"
`
		);
		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.notStrictEqual(result.status, 0);
		assert.ok(
			!result.stdout.includes('deployed') && !result.stderr.includes('deployed'),
			'should not report successful deployment'
		);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.ok(
			state.includes(`frontend.current=${oldRef}`),
			`state should remain old, got: ${state}`
		);
		assert.ok(!state.includes(`frontend.current=${newRef}`));
		const log = readFileSync(logPath, 'utf8');
		const pullCount = (log.match(new RegExp(`pull ${newRef}`, 'g')) || []).length;
		assert.strictEqual(pullCount, 1, 'should have bounded retry (one pull)');
	});

	it('fails loudly while retaining old state and runtime when both state commits fail', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, oldRef + '\n');
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${oldRef}\nowner.custom=keep\n`
		);
		const stateRenameCountPath = fakeMv(binDir, deployRoot, '.release-state.env.', [1, 2]);
		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.notStrictEqual(result.status, 0);
		assert.strictEqual(
			readFileSync(join(deployRoot, 'release-state.env'), 'utf8'),
			`frontend.current=${oldRef}\nowner.custom=keep\n`
		);
		assert.strictEqual(readFileSync(runtimeImagePath, 'utf8'), oldRef + '\n');
		assert.strictEqual(readFileSync(stateRenameCountPath, 'utf8').trim(), '2');
		assert.match(result.stderr, /fake mv: injected failure.*count 1/);
		assert.match(result.stderr, /fake mv: injected failure.*count 2/);
		const log = readFileSync(logPath, 'utf8');
		assert.strictEqual((log.match(new RegExp(`pull ${newRef}`, 'g')) || []).length, 1);
		assert.strictEqual((log.match(new RegExp(`pull ${oldRef}`, 'g')) || []).length, 0);
		assert.strictEqual(
			(log.match(new RegExp(`force-recreate frontend FRONTEND_IMAGE=${newRef}`, 'g')) || []).length,
			1
		);
		assert.strictEqual(
			(log.match(new RegExp(`force-recreate frontend FRONTEND_IMAGE=${oldRef}`, 'g')) || []).length,
			1
		);
	});

	it('canonical placeholder-based Compose configuration contains no release digest', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const newRef = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(join(deployRoot, 'release-state.env'), `frontend.current=${oldRef}\n`);
		const composePath = join(deployRoot, 'chat-microservices/frontend.compose.yml');
		writeFileSync(composePath, 'services:\n  frontend: {}\n');
		// Make new deployment fail at health (so rollback will happen, but compose should remain correct)
		writeExecutable(
			join(binDir, 'docker'),
			`#!/bin/sh
set -eu
printf '%s FRONTEND_IMAGE=%s\\n' "$*" "\${FRONTEND_IMAGE:-}" >> "$FAKE_DOCKER_LOG"
if [ "$1" = pull ] || { [ "$1" = image ] && [ "$2" = inspect ]; }; then exit 0; fi
if [ "$1" = compose ]; then
  case "$*" in
    *" ps -q frontend"*) printf 'fake-frontend-id\\n'; exit 0 ;;
    *" up "*) exit 0 ;;
  esac
fi
if [ "$1" = inspect ]; then
  case "$*" in
    *Config.Image*) printf 'unhealthy\\n' ;;
    *) printf 'unhealthy\\n' ;;
  esac
  exit 0
fi
exit 0
`
		);
		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: newRef,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});
		assert.notStrictEqual(result.status, 0);
		const afterBytes = readFileSync(composePath, 'utf8');
		assert.ok(
			!afterBytes.includes(newRef) && !afterBytes.includes(oldRef),
			'compose file should not contain image digest, only variable placeholder'
		);
		assert.ok(
			afterBytes.includes('FRONTEND_IMAGE'),
			`compose file should contain variable placeholder, got: ${JSON.stringify(afterBytes.slice(0, 300))}`
		);
	});

	it('preserves a different frontend image during unrecorded-candidate cleanup', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const candidate = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const other = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const runtimeImagePath = join(deployRoot, 'runtime-image');
		const frontendIdPath = join(deployRoot, 'frontend-id');
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(runtimeImagePath, other + '\n');
		writeFileSync(frontendIdPath, 'other-frontend-id\n');
		fakeMv(
			binDir,
			deployRoot,
			'.release-state.env.',
			[1],
			`printf '%s\\n' '${other}' > "$FAKE_RUNTIME_IMAGE_FILE"; printf '%s\\n' other-frontend-id > "$FAKE_FRONTEND_ID_FILE"`
		);
		const result = runDeploy({
			...fakeEnv,
			FAKE_RUNTIME_IMAGE_FILE: runtimeImagePath,
			FAKE_FRONTEND_ID_FILE: frontendIdPath,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: candidate,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		assert.strictEqual(readFileSync(runtimeImagePath, 'utf8'), other + '\n');
		assert.strictEqual(readFileSync(frontendIdPath, 'utf8'), 'other-frontend-id\n');
		assert.doesNotMatch(readFileSync(logPath, 'utf8'), /compose .* rm |rm -f other-frontend-id/);
	});

	it('removes a partially created unrecorded candidate by its exact container ID', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const candidate = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		const result = runDeploy({
			...fakeEnv,
			FAKE_STOPPED_CANDIDATE: '1',
			FAKE_COMPOSE_FORCE_RECREATE_FAIL: '1',
			FAKE_COMPOSE_FAIL_IMAGE: candidate,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: candidate,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		assert.ok(!existsSync(fakeEnv.FAKE_RUNTIME_IMAGE_FILE));
		assert.match(readFileSync(logPath, 'utf8'), /rm -f candidate-frontend-id/);
	});

	it('removes an unhealthy initial candidate by its exact container ID', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const candidate = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath, 'unhealthy');
		mkdirSync(join(deployRoot, 'chat-microservices'));
		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: candidate,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		assert.ok(!existsSync(fakeEnv.FAKE_RUNTIME_IMAGE_FILE));
		assert.match(readFileSync(logPath, 'utf8'), /rm -f candidate-frontend-id/);
	});

	it('returns cleanup failure instead of reporting an unrecorded candidate as removed', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const candidate = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		fakeMv(binDir, deployRoot);
		const result = runDeploy({
			...fakeEnv,
			FAKE_DOCKER_RM_FAIL: '1',
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: candidate,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /state commit failed and unrecorded runtime still present/);
		assert.strictEqual(readFileSync(fakeEnv.FAKE_RUNTIME_IMAGE_FILE, 'utf8'), candidate + '\n');
	});

	it('cleans up the candidate and fails loudly when the recorded rollback image cannot be acquired', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const oldRef = `ghcr.io/acme/chat-frontend@sha256:${'b'.repeat(64)}`;
		const candidate = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath, 'unhealthy');
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(join(deployRoot, 'release-state.env'), `frontend.current=${oldRef}\n`);
		const result = runDeploy({
			...fakeEnv,
			FAKE_MISSING_IMAGE: oldRef,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: candidate,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /rollback image acquisition failed; unrecorded candidate removed/);
		assert.ok(!existsSync(fakeEnv.FAKE_RUNTIME_IMAGE_FILE));
		assert.match(readFileSync(logPath, 'utf8'), new RegExp(`pull ${oldRef}`));
	});

	it('canonicalizes duplicate owned keys and omits an empty previous key', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const image = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		const nextImage = `ghcr.io/acme/chat-frontend@sha256:${'c'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(
			join(deployRoot, 'release-state.env'),
			`frontend.current=${image}\nowner.one=1\nfrontend.current=${image}\nfrontend.previous=\nowner.two=2\n`
		);

		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: nextImage,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.strictEqual(result.status, 0);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.strictEqual(state.match(/frontend\.current=/g)?.length, 1);
		assert.ok(state.includes('frontend.previous=' + image));
		assert.ok(state.includes('owner.one=1'));
		assert.ok(state.includes('owner.two=2'));
	});

	it('omits frontend.previous on an initial release with no previous digest', () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const image = `ghcr.io/acme/chat-frontend@sha256:${'a'.repeat(64)}`;
		mkdirSync(binDir);
		const fakeEnv = fakeDocker(binDir, logPath);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(join(deployRoot, 'release-state.env'), 'owner.custom=keep\n');

		const result = runDeploy({
			...fakeEnv,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			IMAGE_REF: image,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		});

		assert.strictEqual(result.status, 0);
		const state = readFileSync(join(deployRoot, 'release-state.env'), 'utf8');
		assert.ok(state.includes('frontend.current=' + image));
		assert.doesNotMatch(state, /frontend\.previous=/);
	});

	it('serializes concurrent releases with the real flock binary', { skip: !hasFlock }, async () => {
		const deployRoot = temporaryRoot();
		const binDir = join(deployRoot, 'bin');
		const logPath = join(deployRoot, 'docker.log');
		const marker = join(deployRoot, 'critical-section');
		const overlap = join(deployRoot, 'overlap');
		mkdirSync(binDir);
		writeExecutable(
			join(binDir, 'docker'),
			[
				'#!/bin/sh',
				'set -eu',
				'printf \'%s FRONTEND_IMAGE=%s\\n\' "$*" "$(printenv FRONTEND_IMAGE || true)" >> "$FAKE_DOCKER_LOG"',
				'if [ "$1" = pull ]; then',
				'  if [ -e "$FAKE_MARKER" ]; then touch "$FAKE_OVERLAP"; fi',
				'  touch "$FAKE_MARKER"',
				'  sleep 1',
				'  rm -f "$FAKE_MARKER"',
				'fi',
				'if [ "$1" = compose ]; then',
				'  case "$*" in',
				'    *" ps -q frontend"*) printf \'fake-frontend-id\\n\';;',
				'    *" up "*) :;;',
				'  esac',
				'fi',
				'if [ "$1" = inspect ]; then',
				'  case "$*" in',
				'    *Config.Image*) printf \'%s\\n\' "$EXPECTED_IMAGE_REF";;',
				"    *) printf 'healthy\\n';;",
				'  esac',
				'fi',
				''
			].join('\n')
		);
		mkdirSync(join(deployRoot, 'chat-microservices'));
		writeFileSync(join(deployRoot, 'release-state.env'), 'owner.custom=keep\\n');
		const common = {
			FAKE_DOCKER_LOG: logPath,
			FAKE_MARKER: marker,
			FAKE_OVERLAP: overlap,
			PATH: `${binDir}:${process.env.PATH}`,
			DEPLOY_ROOT: deployRoot,
			HEALTH_TIMEOUT_SECONDS: '0',
			HEALTH_POLL_SECONDS: '0'
		};
		const first = runDeployAsync({
			...common,
			IMAGE_REF: 'ghcr.io/acme/chat-frontend@sha256:' + 'a'.repeat(64)
		});
		const second = runDeployAsync({
			...common,
			IMAGE_REF: 'ghcr.io/acme/chat-frontend@sha256:' + 'b'.repeat(64)
		});
		const results = await Promise.all([first, second]);
		assert.ok(results.every(({ status }) => status === 0));
		assert.throws(() => readFileSync(overlap));
	});
});
