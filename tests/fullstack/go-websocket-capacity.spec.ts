import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@playwright/test';

test('the Go relay admits 128 connections through the fixture gateway and recovers a slot', async ({
	request
}) => {
	const origin = new URL(process.env.FULLSTACK_ORIGIN!);
	expect(origin.hostname).toBe('127.0.0.1');
	const username = `capacity_${process.env.FULLSTACK_RUN_ID!.slice(-8)}`;
	const email = `${username}@example.com`;
	const password = `FixtureOnly!${randomUUID()}`;
	const account = await request.post('/user/register', { data: { username, email, password } });
	expect(account.status()).toBe(200);
	const { id } = (await account.json()).data;
	const publicSession = await request.get('/user/me');
	expect(publicSession.status()).toBe(200);
	expect(publicSession.headers()['ratelimit-limit']).toBe('100');
	const session = (await request.storageState()).cookies.find((cookie) => cookie.name === 'jwt');
	if (!session) throw new Error('Fixture registration did not set a session cookie');
	const cookie = `jwt=${session.value}`;

	const live = new Set<Duplex>();
	const endpoint = new URL('/ws/v1', origin);
	endpoint.searchParams.set('expectedUserId', id);
	function upgrade() {
		return new Promise<{ status: number; body?: string }>((resolve, reject) => {
			const req = httpsRequest(endpoint, {
				agent: false,
				rejectUnauthorized: false,
				headers: {
					Origin: origin.origin,
					Cookie: cookie,
					Connection: 'Upgrade',
					Upgrade: 'websocket',
					'Sec-WebSocket-Version': '13',
					'Sec-WebSocket-Key': randomBytes(16).toString('base64')
				}
			});
			const timeout = setTimeout(() => req.destroy(new Error('Gateway upgrade timed out')), 5000);
			req.once('upgrade', (response, socket) => {
				clearTimeout(timeout);
				live.add(socket);
				socket.once('close', () => live.delete(socket));
				socket.on('error', () => socket.destroy());
				resolve({ status: response.statusCode ?? 0 });
			});
			req.once('response', (response) => {
				response.setEncoding('utf8');
				let body = '';
				response.on('data', (chunk) => (body += chunk));
				response.once('error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});
				response.once('end', () => {
					clearTimeout(timeout);
					resolve({ status: response.statusCode ?? 0, body });
				});
			});
			req.once('error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
			req.end();
		});
	}

	try {
		for (let i = 0; i < 128; i++) {
			const { status, body } = await upgrade();
			expect(status, `upgrade ${i + 1}: ${body?.trim() ?? 'WebSocket'}`).toBe(101);
			await delay(40);
		}
		expect(live.size).toBe(128);
		expect(await upgrade()).toEqual({ status: 503, body: 'connections unavailable\n' });
		expect(live.size).toBe(128);
		const [first] = live;
		first.destroy();
		await expect.poll(async () => (await upgrade()).status, { timeout: 5000 }).toBe(101);
		expect(live.size).toBe(128);
	} finally {
		for (const socket of live) socket.destroy();
	}
});
