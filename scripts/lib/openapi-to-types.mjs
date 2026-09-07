// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
/**
 * @typedef {object} OpenApiSchema
 * @property {string} [type]
 * @property {string} [description]
 * @property {string} [$ref]
 * @property {(string | number | boolean | null)[]} [enum]
 * @property {boolean} [nullable]
 * @property {OpenApiSchema} [items]
 * @property {Record<string, OpenApiSchema>} [properties]
 * @property {string[]} [required]
 * @property {unknown} [oneOf]
 * @property {unknown} [allOf]
 * @property {unknown} [anyOf]
 * @property {unknown} [not]
 * @property {unknown} [additionalProperties]
 */

/**
 * @typedef {object} OpenApiSpec
 * @property {string} [openapi]
 * @property {{ title?: string, version?: string }} [info]
 * @property {{ schemas?: Record<string, OpenApiSchema> }} [components]
 * @property {Record<string, any>} [paths]
 * @property {string} [x-service-id]
 * @property {string} [x-gateway-prefix]
 */

/**
 * @typedef {object} ContractSource
 * @property {string} backendCommit
 * @property {number} generatorVersion
 */

const identifierCharacter = /^[A-Za-z0-9]$/;
const safePropertyName = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const supportedHttpMethods = new Set(['get', 'post', 'put', 'delete']);
const allHttpMethods = new Set([
	'get',
	'post',
	'put',
	'delete',
	'patch',
	'head',
	'options',
	'trace',
	'connect'
]);
const supportedResponseModes = new Set(['envelope', 'raw']);
const supportedPrimitiveTypes = new Set(['string', 'integer', 'number', 'boolean']);
// supportedSchemaTypes is validated via schemaToTs, keep for reference
// const supportedSchemaTypes = new Set(['string', 'integer', 'number', 'boolean', 'array', 'object']);

function typeIdentifier(name) {
	const encoded = Array.from(name, (character) => {
		if (identifierCharacter.test(character)) return character;
		return `$${character.codePointAt(0)?.toString(16)}$`;
	}).join('');
	const prefixed = /^[0-9]/.test(encoded) ? `$${encoded}` : encoded;
	return prefixed || '$empty$';
}

function propertyName(name) {
	return safePropertyName.test(name) ? name : JSON.stringify(name);
}

function commentText(description) {
	return description.replaceAll('*/', '*\\/').replaceAll(/\r\n?|\n/g, ' ');
}

function assertSafeSegment(value, context) {
	if (!/^\/[A-Za-z0-9_\-/{}]+$/.test(value) || value.includes('//') || !value.startsWith('/')) {
		throw new Error(`${context}: must be safe /segment format: ${value}`);
	}
}

function schemaToTs(schema, namespace, indent = '') {
	if (!schema) return 'unknown';

	if (
		schema.oneOf !== undefined ||
		schema.allOf !== undefined ||
		schema.anyOf !== undefined ||
		schema.not !== undefined
	) {
		throw new Error('Unsupported schema combinator: oneOf/allOf/anyOf/not');
	}
	if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
		if (typeof schema.additionalProperties === 'object')
			throw new Error('Unsupported additionalProperties');
	}

	let type;
	let enumContainsNull = false;
	if (schema.$ref) {
		const prefix = '#/components/schemas/';
		if (!schema.$ref.startsWith(prefix)) {
			throw new Error(`Unsupported non-local OpenAPI reference: ${schema.$ref}`);
		}
		const componentName = schema.$ref
			.slice(prefix.length)
			.replaceAll('~1', '/')
			.replaceAll('~0', '~');
		type = `${namespace}${typeIdentifier(componentName)}`;
	} else if ('enum' in schema) {
		if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
			throw new Error('Empty or malformed enum');
		}
		if (
			schema.type !== undefined &&
			!['string', 'boolean', 'integer', 'number'].includes(schema.type)
		)
			throw new Error(`Unsupported enum type: ${schema.type}`);
		enumContainsNull = schema.enum.includes(null);
		for (const v of schema.enum) {
			if (v === null) {
				if (!schema.nullable) throw new Error('Enum null requires nullable');
				continue;
			}
			if (typeof v === 'number' && !Number.isFinite(v))
				throw new Error('Enum value must be finite number');
			if (
				typeof v === 'object' ||
				Array.isArray(v) ||
				typeof v === 'symbol' ||
				typeof v === 'bigint' ||
				typeof v === 'function' ||
				typeof v === 'undefined'
			) {
				throw new Error('Enum value must be scalar');
			}
			if (schema.type === 'string' && typeof v !== 'string')
				throw new Error('Enum string must be string');
			if (schema.type === 'boolean' && typeof v !== 'boolean')
				throw new Error('Enum boolean must be boolean');
			if (schema.type === 'integer') {
				if (typeof v !== 'number' || !Number.isInteger(v) || !Number.isFinite(v))
					throw new Error('Enum integer must be integer');
			}
			if (schema.type === 'number') {
				if (typeof v !== 'number' || !Number.isFinite(v))
					throw new Error('Enum number must be finite');
			}
			if (!schema.type && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
				throw new Error('Enum value must be scalar');
		}
		type = schema.enum.map((value) => JSON.stringify(value)).join(' | ');
	} else {
		if (schema.oneOf || schema.allOf || schema.anyOf || schema.not !== undefined) {
			throw new Error('Unsupported schema combinator: oneOf/allOf/anyOf/not');
		}
		if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
			if (typeof schema.additionalProperties === 'object') {
				throw new Error('Unsupported additionalProperties');
			}
		}
		switch (schema.type) {
			case 'string':
				type = 'string';
				break;
			case 'integer':
			case 'number':
				type = 'number';
				break;
			case 'boolean':
				type = 'boolean';
				break;
			case 'array': {
				if (!schema.items) throw new Error('Array schema without items');
				const itemType = schemaToTs(schema.items, namespace, indent);
				const wrappedItemType = itemType.includes(' | ') ? `(${itemType})` : itemType;
				type = `${wrappedItemType}[]`;
				break;
			}
			case 'object':
				type = objectSchemaToType(schema, namespace, indent);
				break;
			default:
				if (!schema.type && !schema.$ref && !schema.enum) {
					throw new Error(`Schema with neither type/ref/enum: ${JSON.stringify(schema)}`);
				}
				throw new Error(`Unknown schema type: ${schema.type}`);
		}
	}

	if (schema.nullable && !enumContainsNull) {
		return `${type} | null`;
	}
	return type;
}

function objectSchemaToType(schema, namespace, indent) {
	if (schema.oneOf || schema.allOf || schema.anyOf || schema.not !== undefined) {
		throw new Error('Unsupported schema combinator in object');
	}
	if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
		if (typeof schema.additionalProperties === 'object')
			throw new Error('Unsupported additionalProperties');
	}
	if (!schema.properties) return 'Record<string, unknown>';
	if (Array.isArray(schema.properties)) throw new Error('properties must be object');

	if (schema.required !== undefined) {
		if (!Array.isArray(schema.required)) throw new Error('required must be array');
		const seen = new Set();
		for (const req of schema.required) {
			if (typeof req !== 'string') throw new Error('required must be array of strings');
			if (seen.has(req)) throw new Error(`Duplicate required property: ${req}`);
			seen.add(req);
			if (!schema.properties[req]) throw new Error(`Required property not in properties: ${req}`);
		}
	}

	const nextIndent = `${indent}\t`;
	const properties = Object.entries(schema.properties).map(([name, property]) => {
		const optional = schema.required?.includes(name) ? '' : '?';
		const description = property.description
			? `${nextIndent}/** ${commentText(property.description)} */\n`
			: '';
		return `${description}${nextIndent}${propertyName(name)}${optional}: ${schemaToTs(property, namespace, nextIndent)}`;
	});

	return `{\n${properties.join(';\n')};\n${indent}}`;
}

function objectSchemaToInterface(name, schema, namespace) {
	const description = schema.description ? `/** ${commentText(schema.description)} */\n` : '';
	const properties = Object.entries(schema.properties ?? {}).map(([rawPropertyName, property]) => {
		const optional = schema.required?.includes(rawPropertyName) ? '' : '?';
		const propertyDescription = property.description
			? `\t/** ${commentText(property.description)} */\n`
			: '';
		return `${propertyDescription}\t${propertyName(rawPropertyName)}${optional}: ${schemaToTs(property, namespace, '\t')}`;
	});

	return `${description}export interface ${name} {\n${properties.join(';\n')};\n}`;
}

function componentToTs(name, schema, namespace) {
	if (schema.type === 'object' && schema.properties) {
		return objectSchemaToInterface(name, schema, namespace);
	}

	const description = schema.description ? `/** ${commentText(schema.description)} */\n` : '';
	return `${description}export type ${name} = ${schemaToTs(schema, namespace)}`;
}

function collectOperations(spec, service, expectedTitle, expectedPrefix) {
	if (spec === null || typeof spec !== 'object' || Array.isArray(spec))
		throw new Error('Spec must be non-array object');
	if (spec.openapi !== '3.0.3') throw new Error(`Unsupported openapi version: ${spec.openapi}`);
	if (!spec.info || spec.info.title !== expectedTitle)
		throw new Error(`info.title must be ${expectedTitle}`);
	if (spec['x-service-id'] !== service) throw new Error(`x-service-id must be ${service}`);
	if (spec['x-gateway-prefix'] !== expectedPrefix)
		throw new Error(`x-gateway-prefix must be ${expectedPrefix}`);
	assertSafeSegment(expectedPrefix, 'x-gateway-prefix');
	if (
		spec.components === null ||
		typeof spec.components !== 'object' ||
		Array.isArray(spec.components)
	)
		throw new Error('components must be object');
	if (
		spec.components.schemas === null ||
		typeof spec.components.schemas !== 'object' ||
		Array.isArray(spec.components.schemas)
	)
		throw new Error('components.schemas must be object');
	if (spec.paths === null || typeof spec.paths !== 'object' || Array.isArray(spec.paths))
		throw new Error('paths must be object');

	const identifierMap = new Map();
	for (const name of Object.keys(spec.components.schemas)) {
		const id = typeIdentifier(name);
		const full = `${service === 'user' ? 'UserApi' : 'ChatApi'}${id}`;
		if (identifierMap.has(full)) throw new Error(`Component names collision: ${name} -> ${full}`);
		identifierMap.set(full, name);
	}

	for (const [, schema] of Object.entries(spec.components.schemas)) {
		schemaToTs(schema, service === 'user' ? 'UserApi' : 'ChatApi');
		function validateRefs(s) {
			if (!s || typeof s !== 'object') return;
			if (s.$ref) {
				const prefix = '#/components/schemas/';
				if (!s.$ref.startsWith(prefix)) throw new Error(`Unsupported non-local ref: ${s.$ref}`);
				const target = s.$ref.slice(prefix.length).replaceAll('~1', '/').replaceAll('~0', '~');
				if (!spec.components.schemas[target]) throw new Error(`Unresolved ref: ${s.$ref}`);
			}
			if (s.properties) for (const p of Object.values(s.properties)) validateRefs(p);
			if (s.items) validateRefs(s.items);
		}
		validateRefs(schema);
	}

	const operations = [];
	const seenIds = new Set();
	for (const [path, pathItem] of Object.entries(spec.paths)) {
		if (pathItem === null || typeof pathItem !== 'object' || Array.isArray(pathItem))
			throw new Error(`Path item must be object: ${path}`);
		for (const [rawMethod, operation] of Object.entries(pathItem)) {
			if (allHttpMethods.has(rawMethod) && !supportedHttpMethods.has(rawMethod)) {
				throw new Error(`Unsupported HTTP method: ${rawMethod} for ${path}`);
			}
			if (!supportedHttpMethods.has(rawMethod)) continue;
			if (operation === null || typeof operation !== 'object' || Array.isArray(operation))
				throw new Error(`Operation must be object: ${path} ${rawMethod}`);
			const method = rawMethod.toUpperCase();
			const operationId = operation.operationId;
			if (typeof operationId !== 'string' || operationId.length === 0)
				throw new Error(`Missing operationId: ${path} ${rawMethod}`);
			if (!operationId.startsWith(`${service}.`))
				throw new Error(`operationId must start with ${service}.: ${operationId}`);
			if (seenIds.has(operationId)) throw new Error(`Duplicate operationId: ${operationId}`);
			seenIds.add(operationId);
			const responseMode = operation['x-response-mode'];
			if (!supportedResponseModes.has(responseMode))
				throw new Error(`Invalid x-response-mode for ${operationId}: ${responseMode}`);
			const params = operation.parameters ?? [];
			if (!Array.isArray(params)) throw new Error(`parameters must be array for ${operationId}`);
			const paramNames = new Map();
			for (const param of params) {
				if (param === null || typeof param !== 'object')
					throw new Error(`Parameter must be object for ${operationId}`);
				const { name, in: paramIn, required, schema } = param;
				if (typeof name !== 'string' || name.length === 0)
					throw new Error(`Parameter name must be non-empty for ${operationId}`);
				if (paramIn !== 'path' && paramIn !== 'query')
					throw new Error(`Parameter in must be path or query for ${operationId}`);
				const key = `${paramIn}:${name}`;
				if (paramNames.has(key)) throw new Error(`Duplicate parameter ${key} for ${operationId}`);
				paramNames.set(key, true);
				if (!schema || typeof schema !== 'object')
					throw new Error(`Parameter schema must be object for ${operationId}`);
				if (!supportedPrimitiveTypes.has(schema.type))
					throw new Error(`Unsupported parameter schema type for ${operationId}: ${schema.type}`);
				if (paramIn === 'path' && required !== true)
					throw new Error(`Path parameter must be required for ${operationId}: ${name}`);
			}
			const templateVars = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
			const pathParamNames = params.filter((p) => p.in === 'path').map((p) => p.name);
			if (
				templateVars.length !== pathParamNames.length ||
				!templateVars.every((v) => pathParamNames.includes(v)) ||
				!pathParamNames.every((v) => templateVars.includes(v))
			) {
				throw new Error(
					`Path-template variables and path parameters mismatch for ${operationId}: ${path} vs ${pathParamNames}`
				);
			}
			const responses = operation.responses;
			if (!responses || typeof responses !== 'object')
				throw new Error(`Missing responses for ${operationId}`);
			const successCodes = Object.keys(responses)
				.filter((c) => /^2\d\d$/.test(c))
				.sort((a, b) => Number(a) - Number(b));
			if (successCodes.length === 0) throw new Error(`Missing 2xx response for ${operationId}`);
			const successCode = successCodes[0];
			const successResponse = responses[successCode];
			if (!successResponse || typeof successResponse !== 'object')
				throw new Error(`Invalid success response for ${operationId}`);
			if (successResponse.content) {
				const contentTypes = Object.keys(successResponse.content);
				if (contentTypes.length !== 1 || contentTypes[0] !== 'application/json')
					throw new Error(`Unsupported success content type for ${operationId}`);
				const schema = successResponse.content['application/json'].schema;
				if (schema) {
					if (schema.$ref) {
						const prefix = '#/components/schemas/';
						if (!schema.$ref.startsWith(prefix))
							throw new Error(
								`Unsupported non-local success ref for ${operationId}: ${schema.$ref}`
							);
						const target = schema.$ref
							.slice(prefix.length)
							.replaceAll('~1', '/')
							.replaceAll('~0', '~');
						if (!spec.components.schemas[target])
							throw new Error(`Unresolved success ref for ${operationId}: ${schema.$ref}`);
					} else if (schema.type || schema.enum) {
						throw new Error(`Unsupported inline success schema for ${operationId}`);
					} else if (Object.keys(schema).length !== 0) {
						throw new Error(`Unsupported inline success schema for ${operationId}`);
					}
				}
			}
			if (operation.requestBody?.content) {
				const contentTypes = Object.keys(operation.requestBody.content);
				if (contentTypes.length !== 1 || contentTypes[0] !== 'application/json')
					throw new Error(`Unsupported request content type for ${operationId}`);
				const schema = operation.requestBody.content['application/json'].schema;
				if (schema) {
					if (schema.$ref) {
						const prefix = '#/components/schemas/';
						if (!schema.$ref.startsWith(prefix))
							throw new Error(
								`Unsupported non-local request ref for ${operationId}: ${schema.$ref}`
							);
						const target = schema.$ref
							.slice(prefix.length)
							.replaceAll('~1', '/')
							.replaceAll('~0', '~');
						if (!spec.components.schemas[target])
							throw new Error(`Unresolved request ref for ${operationId}: ${schema.$ref}`);
					} else {
						throw new Error(`Unsupported inline request schema for ${operationId}`);
					}
				}
			}
			operations.push({
				path,
				method,
				operationId,
				responseMode,
				parameters: params,
				operation,
				service,
				expectedPrefix
			});
		}
	}
	return operations;
}

export function generateApiTypes({ userSpec, chatSpec, source }) {
	const out = [
		'/**',
		' * AUTO-GENERATED from committed OpenAPI contracts.',
		` * backendCommit: ${source.backendCommit}`,
		` * generatorVersion: ${source.generatorVersion}`,
		' */'
	];

	collectOperations(userSpec, 'user', 'User Service', '/user');
	collectOperations(chatSpec, 'chat', 'Chat Service', '/chat');

	for (const [name, schema] of Object.entries(userSpec.components?.schemas ?? {})) {
		if (name !== 'Error') {
			out.push(componentToTs(`UserApi${typeIdentifier(name)}`, schema, 'UserApi'));
		}
	}
	for (const [name, schema] of Object.entries(chatSpec.components?.schemas ?? {})) {
		if (name !== 'Error') {
			out.push(componentToTs(`ChatApi${typeIdentifier(name)}`, schema, 'ChatApi'));
		}
	}

	return `${out.join('\n\n')}\n`;
}

/**
 * @param {{ userSpec: OpenApiSpec, chatSpec: OpenApiSpec, source: ContractSource }} input
 * @returns {string}
 */
export function generateApiOperations({ userSpec, chatSpec, source }) {
	const userOps = collectOperations(userSpec, 'user', 'User Service', '/user');
	const chatOps = collectOperations(chatSpec, 'chat', 'Chat Service', '/chat');

	const allOps = [...userOps, ...chatOps];
	const seen = new Set();
	for (const op of allOps) {
		if (seen.has(op.operationId))
			throw new Error(`Duplicate operationId across services: ${op.operationId}`);
		seen.add(op.operationId);
	}

	allOps.sort((a, b) => {
		const pa = `${a.path}:${a.method}`;
		const pb = `${b.path}:${b.method}`;
		return pa.localeCompare(pb);
	});

	const out = [
		'/**',
		' * AUTO-GENERATED from committed OpenAPI contracts.',
		` * backendCommit: ${source.backendCommit}`,
		` * generatorVersion: ${source.generatorVersion}`,
		' */',
		'',
		"export type GeneratedResponseMode = 'envelope' | 'raw';",
		"export type GeneratedHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';",
		'',
		'export interface GeneratedOperationParameter {',
		'\treadonly name: string;',
		"\treadonly in: 'path' | 'query';",
		'\treadonly required: boolean;',
		"\treadonly schemaType: 'string' | 'integer' | 'number' | 'boolean';",
		'}',
		'',
		'export interface GeneratedApiOperation {',
		'\treadonly operationId: string;',
		"\treadonly service: 'user' | 'chat';",
		'\treadonly method: GeneratedHttpMethod;',
		'\treadonly path: string;',
		'\treadonly responseMode: GeneratedResponseMode;',
		'\treadonly parameters: readonly GeneratedOperationParameter[];',
		'\treadonly requestSchema: string | null;',
		'\treadonly successSchema: string | null;',
		'}',
		'',
		'export const apiOperations = {'
	];

	for (const op of allOps) {
		const svc = op.service;
		const gatewayPath = `${op.expectedPrefix}${op.path}`;
		const params = op.parameters
			.map((p) => {
				const schemaType = p.schema.type === 'integer' ? 'integer' : p.schema.type;
				return `{ name: ${JSON.stringify(p.name)}, in: ${JSON.stringify(p.in)}, required: ${p.required ? 'true' : 'false'}, schemaType: ${JSON.stringify(schemaType)} }`;
			})
			.join(', ');
		let requestSchema = 'null';
		if (op.operation.requestBody?.content?.['application/json']?.schema?.$ref) {
			requestSchema = JSON.stringify(
				op.operation.requestBody.content['application/json'].schema.$ref
			);
		}
		let successSchema = 'null';
		const responses = op.operation.responses;
		const successCodes = Object.keys(responses)
			.filter((c) => /^2\d\d$/.test(c))
			.sort((a, b) => Number(a) - Number(b));
		const successCode = successCodes[0];
		const successResponse = responses[successCode];
		if (successResponse?.content?.['application/json']?.schema?.$ref) {
			successSchema = JSON.stringify(successResponse.content['application/json'].schema.$ref);
		}
		out.push(
			`\t${JSON.stringify(op.operationId)}: { operationId: ${JSON.stringify(op.operationId)}, service: ${JSON.stringify(svc)}, method: ${JSON.stringify(op.method)}, path: ${JSON.stringify(gatewayPath)}, responseMode: ${JSON.stringify(op.responseMode)}, parameters: [ ${params} ], requestSchema: ${requestSchema}, successSchema: ${successSchema} } as const,`
		);
	}
	out.push('} as const satisfies Record<string, GeneratedApiOperation>;');
	return out.join('\n') + '\n';
}
