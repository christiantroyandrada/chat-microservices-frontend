import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContractBoundaryError } from '$lib/services/contract-boundary';
import type { GeneratedApiOperation } from '$lib/generated/api.operations';
import { apiOperations } from '$lib/generated/api.operations';

const mockRequest = vi.fn();

vi.mock('$lib/services/api', () => ({
	apiClient: {
		request: (...args: unknown[]) => mockRequest(...args)
	}
}));

const { executeOperation } = await import('$lib/services/api-operation');

describe('api-operation URL builder', () => {
	beforeEach(() => {
		mockRequest.mockReset();
		mockRequest.mockResolvedValue({ success: true, data: {} });
	});

	it('encodes path and query values', async () => {
		const op = apiOperations['user.getById'];
		await executeOperation(op, { userId: 'user/one?' });
		expect(mockRequest).toHaveBeenCalledWith(
			'/user/users/user%2Fone%3F',
			expect.objectContaining({ method: 'GET', responseMode: 'envelope' })
		);
	});

	it('encodes multiple query values in metadata order', async () => {
		const op = apiOperations['chat.listMessages'];
		await executeOperation(op, { receiverId: 'u1', limit: 10, offset: 5 });
		expect(mockRequest).toHaveBeenCalledWith(
			'/chat/get/u1?limit=10&offset=5',
			expect.objectContaining({ method: 'GET' })
		);
	});

	it('rejects missing required path parameter', async () => {
		const op = apiOperations['user.getById'];
		await expect(executeOperation(op, {})).rejects.toBeInstanceOf(ContractBoundaryError);
		await expect(executeOperation(op, { userId: '' })).rejects.toBeInstanceOf(
			ContractBoundaryError
		);
	});

	it('rejects missing required query parameter', async () => {
		const op = apiOperations['user.searchUsers'];
		await expect(executeOperation(op, {})).rejects.toBeInstanceOf(ContractBoundaryError);
	});

	it('rejects unknown parameter', async () => {
		const op = apiOperations['user.getById'];
		await expect(
			executeOperation(op, { userId: 'u1', unknown: 'x' } as unknown as Record<string, unknown>)
		).rejects.toBeInstanceOf(ContractBoundaryError);
	});

	it('omits only optional undefined query values', async () => {
		const op = apiOperations['chat.listMessages'];
		await executeOperation(op, { receiverId: 'u1', limit: undefined, offset: 5 });
		expect(mockRequest).toHaveBeenCalledWith('/chat/get/u1?offset=5', expect.anything());
		await executeOperation(op, { receiverId: 'u1' });
		expect(mockRequest).toHaveBeenCalledWith('/chat/get/u1', expect.anything());
	});

	it('encodes query names and values', async () => {
		const op = apiOperations['user.searchUsers'];
		await executeOperation(op, { q: 'a & b' });
		expect(mockRequest).toHaveBeenCalledWith('/user/search?q=a%20%26%20b', expect.anything());
	});

	it('calls apiClient.request with generated method and responseMode', async () => {
		const op = apiOperations['user.register'];
		await executeOperation(op, {}, { username: 'a', email: 'a@a.com', password: 'secret123' });
		expect(mockRequest).toHaveBeenCalledWith(
			'/user/register',
			expect.objectContaining({ method: 'POST', responseMode: 'envelope' })
		);
		const rawOp = apiOperations['user.health'];
		await executeOperation(rawOp, {});
		expect(mockRequest).toHaveBeenCalledWith(
			'/user/health',
			expect.objectContaining({ method: 'GET', responseMode: 'raw' })
		);
	});

	it('rejects required query null and empty string', async () => {
		const op = apiOperations['user.searchUsers'];
		await expect(
			executeOperation(op, { q: null } as unknown as Record<string, unknown>)
		).rejects.toBeInstanceOf(ContractBoundaryError);
		await expect(
			executeOperation(op, { q: '' } as unknown as Record<string, unknown>)
		).rejects.toBeInstanceOf(ContractBoundaryError);
	});

	it('names operationId in missing and unknown parameter errors', async () => {
		const op = apiOperations['user.getById'];
		await expect(executeOperation(op, {})).rejects.toThrow(/user.getById/);
		await expect(
			executeOperation(op, { userId: 'u1', extra: 'x' } as unknown as Record<string, unknown>)
		).rejects.toThrow(/user.getById/);
		const qop = apiOperations['user.searchUsers'];
		await expect(executeOperation(qop, {})).rejects.toThrow(/user.searchUsers/);
	});

	it('encodes optional null as name=null', async () => {
		const op = apiOperations['chat.listMessages'];
		await executeOperation(op, { receiverId: 'u1', limit: null } as unknown as Record<
			string,
			unknown
		>);
		expect(mockRequest).toHaveBeenCalledWith('/chat/get/u1?limit=null', expect.anything());
	});

	it('throws with operationId for missing placeholder', async () => {
		expect.assertions(1);
		const malformed = {
			operationId: 'user.reviewProbe',
			service: 'user',
			method: 'GET',
			path: '/user/users/{missing}',
			responseMode: 'envelope',
			parameters: [{ name: 'id', in: 'path', required: true, schemaType: 'string' }],
			requestSchema: null,
			successSchema: null
		};
		await expect(
			executeOperation(malformed as unknown as GeneratedApiOperation, { id: 'u1' })
		).rejects.toThrow(/user\.reviewProbe/);
	});

	it('serializes JSON body only when provided', async () => {
		const op = apiOperations['user.getCurrentUser'];
		await executeOperation(op, {});
		expect(mockRequest).toHaveBeenCalledWith(
			'/user/me',
			expect.not.objectContaining({ body: expect.anything() })
		);
		const op2 = apiOperations['user.register'];
		await executeOperation(op2, {}, { x: 1 });
		expect(mockRequest).toHaveBeenCalledWith(
			'/user/register',
			expect.objectContaining({ body: JSON.stringify({ x: 1 }) })
		);
	});
});
