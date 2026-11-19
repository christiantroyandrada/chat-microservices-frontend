import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('ships only the native Go realtime client', () => {
	const root = process.cwd();
	const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	expect(manifest.dependencies).not.toHaveProperty('socket.io-client');
	expect(existsSync(join(root, 'src/lib/services/websocket.service.ts'))).toBe(false);
	function inspect(directory: string) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) inspect(path);
			else if (/\.(ts|js|svelte)$/.test(entry.name)) {
				const source = readFileSync(path, 'utf8');
				expect(source, path).not.toMatch(
					/socket\.io-client|websocket\.service|PUBLIC_GO_WS_ENABLED/
				);
			}
		}
	}
	inspect(join(root, 'src'));
});
