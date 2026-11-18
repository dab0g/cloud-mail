import { describe, expect, it, vi } from 'vitest';
import spamService, { normalizeDeliveryEmail } from '../src/service/spam-service';
import { SpamRecheck } from '../src/durable-objects/spam-recheck';

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

	it('normalizes the freshly received camelCase email before D1 delivery', () => {
		expect(normalizeDeliveryEmail({ emailId: 42, toEmail: 'recipient@example.test', sendEmail: 'sender@example.test', toName: 'Recipient' })).toMatchObject({
			email_id: 42,
			to_email: 'recipient@example.test',
			send_email: 'sender@example.test',
			to_name: 'Recipient'
		});
	});

	it('disables new requests and lets existing alarms expire without processing', async () => {
		const processEmail = vi.spyOn(spamService, 'processEmail');
		const setAlarm = vi.fn();
		const alarm = new SpamRecheck({ storage: { setAlarm } }, {});
		const response = await alarm.fetch(new Request('https://spam-recheck/schedule?emailId=42', { method: 'POST' }));
		await alarm.alarm();
		expect(response.status).toBe(410);
		expect(processEmail).not.toHaveBeenCalled();
		expect(setAlarm).not.toHaveBeenCalled();
		processEmail.mockRestore();
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
