import { EncryptionResultMessageType } from '@privacyresearch/libsignal-protocol-typescript';
import { expect, it, vi } from 'vitest';
import * as signal from '$lib/crypto/signal';
import * as session from '$lib/crypto/signalSession';
import { generateSignalIdentity } from '$lib/crypto/signalKeyManager';
import { IndexedDBSignalProtocolStore } from '$lib/crypto/signalStore';
import { authService } from '$lib/services/auth.service';

vi.mock('$lib/services/auth.service', () => ({
	authService: { fetchSignalKeys: vi.fn(), storeSignalKeys: vi.fn() }
}));

vi.mock('$lib/services/api.generated', () => ({
	userApi: { publishPrekey: vi.fn() }
}));

vi.mock('$lib/config', () => ({ shouldSkipBackup: () => false, markBackupDone: vi.fn() }));

it('decrypts a queued message on sign-in with an existing Signal session and key backup', async () => {
	const sender = crypto.randomUUID();
	const recipient = crypto.randomUUID();
	const device = 'test-device';
	const password = 'test-backup-password';
	const senderStore = new IndexedDBSignalProtocolStore(sender);

	try {
		await senderStore.init();
		await generateSignalIdentity(senderStore);
		await signal.initSignal(recipient);
		const { _signalBundle: bundle } = await signal.generateSignalIdentity();
		const backup = await signal.exportAndEncryptSignalKeys(recipient, device, password);
		vi.mocked(authService.fetchSignalKeys).mockResolvedValue(backup);

		await session.createSessionWithPrekeyBundle(senderStore, { userId: recipient, bundle });
		const first = await session.encryptMessage(senderStore, recipient, 'First message');
		await expect(signal.decryptMessage(sender, first, recipient)).resolves.toBe('First message');
		const reply = await signal.encryptMessage(sender, 'Reply', recipient);
		await expect(session.decryptMessage(senderStore, recipient, reply)).resolves.toBe('Reply');

		const queued = await session.encryptMessage(senderStore, recipient, 'Sent while signed out');
		expect(queued.type).toBe(EncryptionResultMessageType.WhisperMessage);

		expect(await signal.initSignalWithRestore(recipient, device, '', password)).toBe(true);
		await expect(signal.decryptMessage(sender, queued, recipient)).resolves.toBe(
			'Sent while signed out'
		);
		expect(authService.storeSignalKeys).not.toHaveBeenCalled();
	} finally {
		senderStore.close();
		await signal.clearSignalState(sender);
		await signal.clearSignalState(recipient);
	}
});
