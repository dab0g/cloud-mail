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
});
