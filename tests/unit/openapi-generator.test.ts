import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
	symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { generateApiTypes, generateApiOperations } from '../../scripts/lib/openapi-to-types.mjs';
import {
	FRONTEND_ARTIFACT_PATHS,
	MANIFEST_RELATIVE_PATH
} from '../../scripts/lib/contract-snapshot.mjs';

const root = resolve(import.meta.dirname, '../..');
const userSpec = JSON.parse(
	readFileSync(resolve(root, 'contracts/user-service.openapi.json'), 'utf8')
);
const chatSpec = JSON.parse(
	readFileSync(resolve(root, 'contracts/chat-service.openapi.json'), 'utf8')
);
const source = { backendCommit: 'contract-test', generatorVersion: 1 };
const cliSource = {
	backendCommit: 'a'.repeat(40),
	generatorVersion: 1,
	backendSources: {
		'chat-service/openapi.json': 'b'.repeat(64),
		'user-service/openapi.json': 'c'.repeat(64)
	}
};
const temporaryRoots: string[] = [];

const unsafeUserSpec = {
	openapi: '3.0.3',
	info: { title: 'User Service', version: '1.0.0' },
	'x-service-id': 'user',
	'x-gateway-prefix': '/user',
	components: {
		schemas: {
			'Bad-Name': {
				type: 'object',
				description: 'closes */ comment\nnext',
				required: ['x-id', 'kind'],
				properties: {
					'x-id': { type: 'string' },
					kind: { type: 'string', enum: ['line\nbreak', 'quote"slash\\'] }
				}
			},
			Wrapper: {
				type: 'object',
				required: ['value'],
				properties: {
					value: { $ref: '#/components/schemas/Bad-Name' }
				}
			}
		}
	},
	paths: {}
};

function makeTemporaryRoot(prefix: string) {
	const path = mkdtempSync(join(tmpdir(), prefix));
	temporaryRoots.push(path);
	return path;
}

function runNode(script: string, args: string[]) {
	return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

function writeJson(path: string, value: unknown) {
	writeFileSync(path, JSON.stringify(value, null, '\t') + '\n');
}

function hashFile(path: string) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function copyGeneratorScripts(cliRoot: string) {
	for (const file of [
		'scripts/gen-api-types.mjs',
		'scripts/lib/atomic-contract-files.mjs',
		'scripts/lib/contract-snapshot.mjs',
		'scripts/lib/openapi-to-types.mjs'
	]) {
		const target = resolve(cliRoot, file);
		mkdirSync(resolve(target, '..'), { recursive: true });
		copyFileSync(resolve(root, file), target);
	}
}

function seedCliManifest(cliRoot: string) {
	writeJson(resolve(cliRoot, 'contracts/contract-snapshot.manifest.json'), {
		schemaVersion: 1,
		backendCommit: cliSource.backendCommit,
		generatorVersion: 1,
		backendSources: cliSource.backendSources,
		frontendArtifacts: Object.fromEntries(
			FRONTEND_ARTIFACT_PATHS.map((path) => [
				path,
				[
					'contracts/chat-service.openapi.json',
					'contracts/source.json',
					'contracts/user-service.openapi.json'
				].includes(path)
					? hashFile(resolve(cliRoot, path))
					: '0'.repeat(64)
			])
		)
	});
}

function makeGeneratorCliRoot(prefix: string) {
	const cliRoot = makeTemporaryRoot(prefix);
	mkdirSync(resolve(cliRoot, 'contracts'), { recursive: true });
	mkdirSync(resolve(cliRoot, 'src/lib/generated'), { recursive: true });
	copyGeneratorScripts(cliRoot);
	copyFileSync(resolve(root, '.prettierrc'), resolve(cliRoot, '.prettierrc'));
	symlinkSync(resolve(root, 'node_modules'), resolve(cliRoot, 'node_modules'), 'dir');
	writeJson(resolve(cliRoot, 'contracts/user-service.openapi.json'), userSpec);
	writeJson(resolve(cliRoot, 'contracts/chat-service.openapi.json'), chatSpec);
	writeJson(resolve(cliRoot, 'contracts/source.json'), cliSource);
	seedCliManifest(cliRoot);
	return cliRoot;
}

function initializeCliGit(cliRoot: string) {
	execFileSync('git', ['init'], { cwd: cliRoot, encoding: 'utf8' });
	execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: cliRoot });
	execFileSync('git', ['config', 'user.name', 'Test'], { cwd: cliRoot });
	execFileSync('git', ['add', ...FRONTEND_ARTIFACT_PATHS, MANIFEST_RELATIVE_PATH], {
		cwd: cliRoot
	});
	execFileSync('git', ['commit', '-m', 'snapshot'], { cwd: cliRoot });
}

afterEach(() => {
	for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('OpenAPI type generator', () => {
	it('is deterministic and records its source', () => {
		const first = generateApiTypes({ userSpec, chatSpec, source });
		const second = generateApiTypes({ userSpec, chatSpec, source });
		expect(first).toBe(second);
		expect(first).toContain('backendCommit: contract-test');
	});

	it('generates exact prekey, array, pagination, and status types', () => {
		const output = generateApiTypes({ userSpec, chatSpec, source });
		expect(output).toContain('export interface UserApiPublishPrekeyRequest');
		expect(output).toContain('preKeys: UserApiOneTimePreKey[]');
		expect(output).toContain('export interface UserApiConsumedPrekey');
		expect(output).toContain('bundle: UserApiPrekeyBundle');
		expect(output).toContain('data: UserApiSearchUser[]');
		expect(output).toContain('pagination: ChatApiPagination');
		expect(output).toContain('status: "NotDelivered" | "Delivered" | "Seen"');
	});

	it('preserves optional properties and nested nullable values', () => {
		const output = generateApiTypes({ userSpec, chatSpec, source });
		expect(output).toContain('status?: "ok" | "degraded" | "error"');
		expect(output).toContain('redis?: boolean | null');
	});

	it('maps unsafe component names consistently and quotes unsafe property names', () => {
		const output = generateApiTypes({
			userSpec: unsafeUserSpec,
			chatSpec: {
				openapi: '3.0.3',
				info: { title: 'Chat Service', version: '1.0.0' },
				'x-service-id': 'chat',
				'x-gateway-prefix': '/chat',
				components: { schemas: {} },
				paths: {}
			},
			source
		});
		expect(output).toContain('export interface UserApiBad$2d$Name');
		expect(output).toContain('"x-id": string');
		expect(output).toContain('value: UserApiBad$2d$Name');
	});

	it('serializes unsafe enum literals and sanitizes descriptions into valid TypeScript', () => {
		const output = generateApiTypes({
			userSpec: unsafeUserSpec,
			chatSpec: {
				openapi: '3.0.3',
				info: { title: 'Chat Service', version: '1.0.0' },
				'x-service-id': 'chat',
				'x-gateway-prefix': '/chat',
				components: { schemas: {} },
				paths: {}
			},
			source
		});
		expect(output).toContain('kind: "line\\nbreak" | "quote\\"slash\\\\"');
		expect(output).toContain('/** closes *\\/ comment next */');

		const result = transpileModule(output, {
			compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ESNext },
			reportDiagnostics: true
		});
		expect(result.diagnostics ?? []).toEqual([]);
	});

	it('rejects unknown generator CLI arguments', () => {
		const result = runNode(resolve(root, 'scripts/gen-api-types.mjs'), ['--unknown']);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Usage: node scripts/gen-api-types.mjs [--check]');
	});

	it('rejects invalid sync contract inputs before copying', () => {
		const backendDir = makeTemporaryRoot('openapi-sync-');
		mkdirSync(resolve(backendDir, 'user-service'), { recursive: true });
		mkdirSync(resolve(backendDir, 'chat-service'), { recursive: true });
		writeFileSync(resolve(backendDir, 'user-service/openapi.json'), '{ invalid json');
		writeFileSync(resolve(backendDir, 'chat-service/openapi.json'), '{}');
		execFileSync('git', ['init'], { cwd: backendDir, encoding: 'utf8' });
		execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: backendDir });
		execFileSync('git', ['config', 'user.name', 'Test'], { cwd: backendDir });
		execFileSync('git', ['add', '.'], { cwd: backendDir });
		execFileSync('git', ['commit', '-m', 'invalid contract'], { cwd: backendDir });

		const result = runNode(resolve(root, 'scripts/sync-api-contracts.mjs'), [
			'--backend-dir',
			backendDir
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Invalid JSON in user-service/openapi.json');
	});

	describe('OpenAPI enum validation — fix round 2 table', () => {
		const cases: Array<{ name: string; schema: unknown; shouldThrow: boolean }> = [
			{ name: 'string+number', schema: { type: 'string', enum: ['a', 123] }, shouldThrow: true },
			{ name: 'boolean+string', schema: { type: 'boolean', enum: [true, 'a'] }, shouldThrow: true },
			{ name: 'integer+string', schema: { type: 'integer', enum: [1, 'a'] }, shouldThrow: true },
			{ name: 'integer+fraction', schema: { type: 'integer', enum: [1, 1.5] }, shouldThrow: true },
			{ name: 'number+string', schema: { type: 'number', enum: [1, 'a'] }, shouldThrow: true },
			{
				name: 'number+Infinity',
				schema: { type: 'number', enum: [1, Infinity] },
				shouldThrow: true
			},
			{ name: 'object', schema: { enum: [{}] }, shouldThrow: true },
			{ name: 'array', schema: { enum: [[]] }, shouldThrow: true },
			{ name: 'invalid null', schema: { enum: [null] }, shouldThrow: true },
			{
				name: 'valid string enums',
				schema: { type: 'string', enum: ['a', 'b'] },
				shouldThrow: false
			},
			{
				name: 'nullable enums',
				schema: { type: 'string', nullable: true, enum: ['a', null] },
				shouldThrow: false
			},
			{
				name: 'nullable string literal null',
				schema: { type: 'string', nullable: true, enum: ['null'] },
				shouldThrow: false
			},
			{
				name: 'nullable object type',
				schema: { type: 'object', nullable: true, enum: [null] },
				shouldThrow: true
			}
		];
		it('rejects malformed falsey enum containers', () => {
			const falseyValues: Array<{ value: unknown; name: string }> = [
				{ value: null, name: 'null' },
				{ value: false, name: 'false' },
				{ value: 0, name: '0' },
				{ value: '', name: "''" },
				{ value: undefined, name: 'undefined' }
			];
			for (const { value, name } of falseyValues) {
				const badSpec = JSON.parse(JSON.stringify(userSpec));
				(badSpec.components.schemas.User.properties as unknown as Record<string, unknown>).id = {
					enum: value
				} as unknown as Record<string, unknown>;
				expect(
					() => generateApiTypes({ userSpec: badSpec, chatSpec, source }),
					`falsey ${name} should throw`
				).toThrow();
			}
			const badSpec2 = JSON.parse(JSON.stringify(userSpec));
			(badSpec2.components.schemas.User.properties as unknown as Record<string, unknown>).id = {
				enum: undefined
			} as unknown as Record<string, unknown>;
			expect(() => generateApiTypes({ userSpec: badSpec2, chatSpec, source })).toThrow();
		});

		for (const c of cases) {
			it(`enum ${c.name} ${c.shouldThrow ? 'rejects' : 'accepts'}`, () => {
				const badSpec = JSON.parse(JSON.stringify(userSpec));
				badSpec.components.schemas.User.properties.id = c.schema;
				if (c.shouldThrow) {
					expect(() => generateApiTypes({ userSpec: badSpec, chatSpec, source })).toThrow();
					expect(() => generateApiOperations({ userSpec: badSpec, chatSpec, source })).toThrow();
				} else {
					expect(() => generateApiTypes({ userSpec: badSpec, chatSpec, source })).not.toThrow();
					const out = generateApiTypes({ userSpec: badSpec, chatSpec, source });
					if (c.name === 'nullable enums') {
						expect(out).toContain('id: "a" | null;');
						expect(out).not.toContain('"a" | null | null');
					}
				}
			});
		}

		it('nullable string literal null renders id: "null" | null', () => {
			const badSpec = JSON.parse(JSON.stringify(userSpec));
			badSpec.components.schemas.User.properties.id = {
				type: 'string',
				nullable: true,
				enum: ['null']
			};
			const out = generateApiTypes({ userSpec: badSpec, chatSpec, source });
			expect(out).toContain('id: "null" | null;');
		});
	});

	describe('OpenAPI operation validation — fix round 1 adversarial', () => {
		it('rejects wrong service prefix in operationId and cannot render /chat/register from user spec', () => {
			const badUser = JSON.parse(JSON.stringify(userSpec));
			badUser.paths['/register'].post.operationId = 'chat.register';
			expect(() => generateApiTypes({ userSpec: badUser, chatSpec, source })).toThrow(
				/operationId must start with/
			);
			expect(() => generateApiOperations({ userSpec: badUser, chatSpec, source })).toThrow(
				/operationId must start with/
			);
			// Also ensure it cannot render /chat/register from user spec
			let threw = false;
			try {
				generateApiOperations({ userSpec: badUser, chatSpec, source });
			} catch (e) {
				threw = true;
				expect(String((e as Error).message)).not.toContain('/chat/register');
			}
			expect(threw).toBe(true);
		});

		it('rejects enum with object value', () => {
			const badSpec = JSON.parse(JSON.stringify(userSpec));
			badSpec.components.schemas.User.properties.id = { enum: [{}] } as unknown as Record<
				string,
				unknown
			>;
			expect(() => generateApiTypes({ userSpec: badSpec, chatSpec, source })).toThrow(
				/Enum value must be scalar/i
			);
			expect(() => generateApiOperations({ userSpec: badSpec, chatSpec, source })).toThrow(
				/Enum value must be scalar/i
			);
		});

		it('rejects schema with both $ref and oneOf', () => {
			const badSpec = JSON.parse(JSON.stringify(userSpec));
			badSpec.components.schemas.User.properties.id = {
				$ref: '#/components/schemas/User',
				oneOf: []
			} as unknown as Record<string, unknown>;
			expect(() => generateApiTypes({ userSpec: badSpec, chatSpec, source })).toThrow(/oneOf/);
		});

		it('rejects array-shaped components.schemas', () => {
			const badSpec = JSON.parse(JSON.stringify(userSpec));
			(badSpec as unknown as { components: { schemas: unknown } }).components.schemas = [];
			expect(() => generateApiTypes({ userSpec: badSpec, chatSpec, source })).toThrow(
				/components.schemas must be object/
			);
		});

		it('rejects PATCH and does not emit PATCH outside generated union', () => {
			const badUser = JSON.parse(JSON.stringify(userSpec));
			badUser.paths['/register'].patch = {
				operationId: 'user.patchTest',
				'x-response-mode': 'envelope',
				responses: {
					'200': {
						description: 'ok',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } }
						}
					}
				}
			};
			expect(() => generateApiTypes({ userSpec: badUser, chatSpec, source })).toThrow(
				/unsupported.*method/i
			);
			expect(() => generateApiOperations({ userSpec: badUser, chatSpec, source })).toThrow(
				/unsupported.*method/i
			);
			// Ensure generated union still only contains GET|POST|PUT|DELETE
			const ops = generateApiOperations({ userSpec, chatSpec, source });
			expect(ops).not.toContain('"PATCH"');
		});
	});

	describe('OpenAPI operation validation', () => {
		it('rejects missing operationId', () => {
			const badSpec = JSON.parse(JSON.stringify(userSpec));
			delete badSpec.paths['/register'].post.operationId;
			expect(() => generateApiTypes({ userSpec: badSpec, chatSpec, source })).toThrow(
				/Missing operationId/
			);
			expect(() => generateApiOperations({ userSpec: badSpec, chatSpec, source })).toThrow(
				/Missing operationId/
			);
		});

		it('rejects duplicate operationId', () => {
			const badSpec = JSON.parse(JSON.stringify(userSpec));
			badSpec.paths['/login'].post.operationId = 'user.register';
			expect(() => generateApiTypes({ userSpec: badSpec, chatSpec, source })).toThrow(
				/Duplicate operationId/
			);
		});

		it('rejects service/title/prefix/version mismatch', () => {
			const badUser = JSON.parse(JSON.stringify(userSpec));
			badUser['x-service-id'] = 'chat';
			expect(() => generateApiTypes({ userSpec: badUser, chatSpec, source })).toThrow(
				/x-service-id must be user/
			);
			const badTitle = JSON.parse(JSON.stringify(userSpec));
			badTitle.info.title = 'Wrong';
			expect(() => generateApiTypes({ userSpec: badTitle, chatSpec, source })).toThrow(
				/info.title must be User Service/
			);
			const badPrefix = JSON.parse(JSON.stringify(userSpec));
			badPrefix['x-gateway-prefix'] = 'nope';
			expect(() => generateApiTypes({ userSpec: badPrefix, chatSpec, source })).toThrow(
				/x-gateway-prefix must be/
			);
			const badVersion = JSON.parse(JSON.stringify(userSpec));
			badVersion.openapi = '3.0.0';
			badVersion.openapi = '2.0';
			expect(() => generateApiTypes({ userSpec: badVersion, chatSpec, source })).toThrow(
				/Unsupported openapi version/
			);
		});

		it('rejects unresolved and remote refs', () => {
			const badSpec = JSON.parse(JSON.stringify(userSpec));
			badSpec.paths['/register'].post.requestBody.content['application/json'].schema.$ref =
				'#/components/schemas/Missing';
			expect(() => generateApiTypes({ userSpec: badSpec, chatSpec, source })).toThrow(/Unresolved/);
			const remoteSpec = JSON.parse(JSON.stringify(userSpec));
			remoteSpec.paths['/register'].post.requestBody.content['application/json'].schema.$ref =
				'https://example.com/schema.json';
			expect(() => generateApiTypes({ userSpec: remoteSpec, chatSpec, source })).toThrow(
				/Unsupported non-local/
			);
		});

		it('rejects malformed required', () => {
			const notArray = JSON.parse(JSON.stringify(userSpec));
			notArray.components.schemas.User.required = 'not-array';
			expect(() => generateApiTypes({ userSpec: notArray, chatSpec, source })).toThrow(
				/required must be array/
			);
			const duplicate = JSON.parse(JSON.stringify(userSpec));
			duplicate.components.schemas.User.required = ['id', 'id'];
			expect(() => generateApiTypes({ userSpec: duplicate, chatSpec, source })).toThrow(
				/Duplicate required/
			);
			const unknownProp = JSON.parse(JSON.stringify(userSpec));
			unknownProp.components.schemas.User.required = ['id', 'missing'];
			expect(() => generateApiTypes({ userSpec: unknownProp, chatSpec, source })).toThrow(
				/Required property not in properties/
			);
		});

		it('rejects oneOf/allOf/anyOf, unknown type, missing array items, unsupported inline operation schema', () => {
			const oneOfSpec = JSON.parse(JSON.stringify(userSpec));
			oneOfSpec.components.schemas.User.oneOf = [];
			expect(() => generateApiTypes({ userSpec: oneOfSpec, chatSpec, source })).toThrow(
				/Unsupported schema combinator/
			);
			const unknownType = JSON.parse(JSON.stringify(userSpec));
			unknownType.components.schemas.User.properties.id.type = 'unknowntype';
			expect(() => generateApiTypes({ userSpec: unknownType, chatSpec, source })).toThrow(
				/Unknown schema type/
			);
			const missingItems = JSON.parse(JSON.stringify(userSpec));
			missingItems.components.schemas.UserListResponse.properties.data = { type: 'array' };
			expect(() => generateApiTypes({ userSpec: missingItems, chatSpec, source })).toThrow(
				/Array schema without items/
			);
			const inlineSpec = JSON.parse(JSON.stringify(userSpec));
			inlineSpec.paths['/register'].post.requestBody.content['application/json'].schema = {
				type: 'object',
				properties: { x: { type: 'string' } }
			};
			expect(() => generateApiTypes({ userSpec: inlineSpec, chatSpec, source })).toThrow(
				/Unsupported inline request schema/
			);
		});

		it('handles leading-digit component name deterministically', () => {
			const digitSpec = {
				openapi: '3.0.3',
				info: { title: 'User Service', version: '1.0.0' },
				'x-service-id': 'user',
				'x-gateway-prefix': '/user',
				components: {
					schemas: {
						'123Result': { type: 'object', properties: { id: { type: 'string' } } },
						'123Result2': { type: 'object', properties: { id: { type: 'string' } } }
					}
				},
				paths: {
					'/test': {
						get: {
							operationId: 'user.test',
							'x-response-mode': 'envelope',
							responses: {
								'200': {
									description: 'ok',
									content: {
										'application/json': { schema: { $ref: '#/components/schemas/123Result' } }
									}
								}
							}
						}
					}
				}
			};
			const out = generateApiTypes({
				userSpec: digitSpec,
				chatSpec: {
					openapi: '3.0.3',
					info: { title: 'Chat Service', version: '1.0.0' },
					'x-service-id': 'chat',
					'x-gateway-prefix': '/chat',
					components: { schemas: {} },
					paths: {}
				},
				source
			});
			expect(out).toContain('UserApi$123Result');
			expect(out).not.toContain('UserApi123Result');
		});

		it('rejects path-template/parameter mismatch, duplicate parameters, optional path parameter', () => {
			const mismatch = JSON.parse(JSON.stringify(userSpec));
			mismatch.paths['/users/{userId}'].get.parameters[0].name = 'wrong';
			expect(() => generateApiTypes({ userSpec: mismatch, chatSpec, source })).toThrow(
				/Path-template variables and path parameters mismatch/
			);
			const duplicate = JSON.parse(JSON.stringify(userSpec));
			duplicate.paths['/search'].get.parameters.push({
				name: 'q',
				in: 'query',
				required: true,
				schema: { type: 'string' }
			});
			expect(() => generateApiTypes({ userSpec: duplicate, chatSpec, source })).toThrow(
				/Duplicate parameter/
			);
			const optionalPath = JSON.parse(JSON.stringify(userSpec));
			optionalPath.paths['/users/{userId}'].get.parameters[0].required = false;
			expect(() => generateApiTypes({ userSpec: optionalPath, chatSpec, source })).toThrow(
				/Path parameter must be required/
			);
		});

		it('generates deterministic operation metadata', () => {
			const ops1 = generateApiOperations({ userSpec, chatSpec, source });
			const ops2 = generateApiOperations({ userSpec, chatSpec, source });
			expect(ops1).toBe(ops2);
			expect(ops1).toContain('"user.register"');
			expect(ops1).toContain('"chat.sendMessage"');
			expect(ops1).toContain('"/user/register"');
			expect(ops1).toContain('method: "POST"');
			expect(ops1).toContain('responseMode: "envelope"');
			expect(ops1).toContain('requestSchema: "#/components/schemas/RegisterRequest"');
			expect(ops1).toContain('successSchema: "#/components/schemas/UserResponse"');
			expect(ops1).toContain('parameters: [ { name: "q"');
		});

		it('mutating operation fields changes output and makes --check fail without writes', () => {
			const cliRoot = makeGeneratorCliRoot('openapi-drift-');
			const typesPath = resolve(cliRoot, 'src/lib/generated/api.types.ts');
			const opsPath = resolve(cliRoot, 'src/lib/generated/api.operations.ts');
			let result = runNode(resolve(cliRoot, 'scripts/gen-api-types.mjs'), []);
			expect(result.status, result.stderr).toBe(0);
			initializeCliGit(cliRoot);
			const beforeTypes = readFileSync(typesPath, 'utf8');
			const beforeOps = readFileSync(opsPath, 'utf8');
			const beforeTypesMtime = statSync(typesPath).mtimeMs;
			const beforeOpsMtime = statSync(opsPath).mtimeMs;
			// Mutate a field (e.g., change operationId)
			const mutatedUser = JSON.parse(JSON.stringify(userSpec));
			mutatedUser.paths['/register'].post.operationId = 'user.registerMutated';
			writeFileSync(
				resolve(cliRoot, 'contracts/user-service.openapi.json'),
				JSON.stringify(mutatedUser) + '\n'
			);
			result = runNode(resolve(cliRoot, 'scripts/gen-api-types.mjs'), ['--check']);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain('Modified artifact');
			expect(readFileSync(typesPath, 'utf8')).toBe(beforeTypes);
			expect(readFileSync(opsPath, 'utf8')).toBe(beforeOps);
			expect(statSync(typesPath).mtimeMs).toBe(beforeTypesMtime);
			expect(statSync(opsPath).mtimeMs).toBe(beforeOpsMtime);
		});

		it('generator validation failure leaves both output files byte-identical', () => {
			const cliRoot = makeGeneratorCliRoot('openapi-failclosed-');
			const typesPath = resolve(cliRoot, 'src/lib/generated/api.types.ts');
			const opsPath = resolve(cliRoot, 'src/lib/generated/api.operations.ts');
			const manifestPath = resolve(cliRoot, MANIFEST_RELATIVE_PATH);
			let result = runNode(resolve(cliRoot, 'scripts/gen-api-types.mjs'), []);
			expect(result.status, result.stderr).toBe(0);
			// Make invalid spec (duplicate operationId)
			const badUser = JSON.parse(JSON.stringify(userSpec));
			badUser.paths['/login'].post.operationId = 'user.register';
			const userPath = resolve(cliRoot, 'contracts/user-service.openapi.json');
			writeFileSync(userPath, JSON.stringify(badUser) + '\n');
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
				frontendArtifacts: Record<string, string>;
			};
			manifest.frontendArtifacts['contracts/user-service.openapi.json'] = hashFile(userPath);
			writeJson(manifestPath, manifest);
			const beforeTypes = readFileSync(typesPath, 'utf8');
			const beforeOps = readFileSync(opsPath, 'utf8');
			const beforeManifest = readFileSync(manifestPath, 'utf8');
			const beforeTypesMtime = statSync(typesPath).mtimeMs;
			const beforeOpsMtime = statSync(opsPath).mtimeMs;
			const beforeManifestMtime = statSync(manifestPath).mtimeMs;
			result = runNode(resolve(cliRoot, 'scripts/gen-api-types.mjs'), []);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain('Duplicate operationId');
			expect(readFileSync(typesPath, 'utf8')).toBe(beforeTypes);
			expect(readFileSync(opsPath, 'utf8')).toBe(beforeOps);
			expect(readFileSync(manifestPath, 'utf8')).toBe(beforeManifest);
			expect(statSync(typesPath).mtimeMs).toBe(beforeTypesMtime);
			expect(statSync(opsPath).mtimeMs).toBe(beforeOpsMtime);
			expect(statSync(manifestPath).mtimeMs).toBe(beforeManifestMtime);
		});
	});

	it('check-only reports drift without writing the generated file', () => {
		const cliRoot = makeGeneratorCliRoot('openapi-check-');

		const outPath = resolve(cliRoot, 'src/lib/generated/api.types.ts');
		const generated = runNode(resolve(cliRoot, 'scripts/gen-api-types.mjs'), []);
		expect(generated.status, generated.stderr).toBe(0);
		writeFileSync(outPath, 'stale output\n');
		initializeCliGit(cliRoot);
		const before = { content: readFileSync(outPath, 'utf8'), mtimeMs: statSync(outPath).mtimeMs };
		const result = runNode(resolve(cliRoot, 'scripts/gen-api-types.mjs'), ['--check']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Modified artifact: src/lib/generated/api.types.ts');
		expect(readFileSync(outPath, 'utf8')).toBe(before.content);
		expect(statSync(outPath).mtimeMs).toBe(before.mtimeMs);
	});
});
