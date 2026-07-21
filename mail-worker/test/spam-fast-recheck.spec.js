import { describe, expect, it, vi } from 'vitest';
import spamService from '../src/service/spam-service';

describe('fast spam recheck scheduling', () => {
	it('addresses a Durable Object by email and schedules a POST request', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		const get = vi.fn(() => ({ fetch }));
		const idFromName = vi.fn(() => 'object-id');
		await spamService.scheduleFastRecheck({ env: { SPAM_RECHECK: { idFromName, get } } }, 42);
		expect(idFromName).toHaveBeenCalledWith('email:42');
		expect(get).toHaveBeenCalledWith('object-id');
		expect(fetch).toHaveBeenCalledWith('https://spam-recheck/schedule?emailId=42', { method: 'POST' });
	});

	it('does nothing when the Durable Object binding is absent', async () => {
		await expect(spamService.scheduleFastRecheck({ env: {} }, 42)).resolves.toBeUndefined();
	});

	it('sends a temporary pending notification to the spam topic', async () => {
		const deliver = vi.fn();
		await spamService.deliverPendingSpam.call({ deliver }, { env: {} }, { email_id: 42 });
		expect(deliver).toHaveBeenCalledWith(
			{ env: {} },
			{ email_id: 42 },
			{ isSpam: 1, score: 0, reasons: ['cloudflare:pending'] },
			{ isSpam: 1, score: 0, reasons: ['cloudflare:pending'], pending: true },
			'spam'
		);
	});

	it('moves a temporary spam notification to normal after a normal decision', async () => {
		const temporarySpam = { state: 'sent', telegram_message_id: 77 };
		const service = { activeDelivery: vi.fn(async (_, __, kind) => kind === 'spam' ? temporarySpam : null), deliver: vi.fn(), deleteDelivery: vi.fn() };
		await spamService.reconcileDelivery.call(service, { env: {} }, { email_id: 42 }, { isSpam: 0 }, { score: 0 });
		expect(service.deliver).toHaveBeenCalledWith({ env: {} }, { email_id: 42 }, { isSpam: 0 }, { score: 0 }, 'normal');
		expect(service.activeDelivery).toHaveBeenCalledWith({ env: {} }, 42, 'spam');
		expect(service.deleteDelivery).toHaveBeenCalledWith({ env: {} }, temporarySpam);
	});

	it('replaces a temporary spam notification with the final spam notification', async () => {
		const temporarySpam = { state: 'sent', telegram_message_id: 77 };
		const service = { activeDelivery: vi.fn(async (_, __, kind) => kind === 'spam' ? temporarySpam : null), deliver: vi.fn(), deleteDelivery: vi.fn() };
		await spamService.reconcileDelivery.call(service, { env: {} }, { email_id: 42 }, { isSpam: 1 }, { score: 6 }, true);
		expect(service.deleteDelivery).toHaveBeenCalledWith({ env: {} }, temporarySpam);
		expect(service.deliver).toHaveBeenCalledWith({ env: {} }, { email_id: 42 }, { isSpam: 1 }, { score: 6 }, 'spam');
	});
});
