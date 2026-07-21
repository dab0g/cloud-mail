import { describe, expect, it } from 'vitest';
import { evaluateSpamPolicy } from '../src/service/spam-service';

const settings = {
	spamEnabled: 1, spamThreshold: 5, spamCfIsSpam: 1,
	spamIgnoreNonfinalNone: 1, spamMinSignals: 1,
	spamSpfSoftfail: 2, spamSpfNone: 2, spamSpfFail: 4,
	spamDkimNone: 2, spamDkimFail: 4, spamDmarcNone: 2, spamDmarcFail: 4
};

describe('Cloudflare email spam policy', () => {
	it('scores both supplied softfail / none examples as spam', () => {
		const decision = evaluateSpamPolicy(settings, [], 'softfail-sample@example.test', { isLastEvent: 1, isSpam: 0, spf: 'softfail', dkim: 'none', dmarc: 'none' });
		expect(decision).toMatchObject({ isSpam: 1, score: 6 });
	});

	it('uses the configured five point threshold for authentication failures', () => {
		const decision = evaluateSpamPolicy(settings, [], 'none-sample@example.test', { isLastEvent: 1, isSpam: 0, spf: 'softfail', dkim: 'none', dmarc: 'none' });
		expect(decision.isSpam).toBe(1);
		expect(decision.reasons).toContain('spf:softfail(+2)');
	});

	it('applies spam-list before allowlist and Cloudflare isSpam', () => {
		const rules = [
			{ match_type: 'email', value: 'sender@example.com', action: 'normal' },
			{ match_type: 'domain', value: 'example.com', action: 'spam' }
		];
		const decision = evaluateSpamPolicy(settings, rules, 'Sender@Example.com', { isSpam: 1 });
		expect(decision).toMatchObject({ isSpam: 1, reasons: ['spam-list'] });
	});

	it('honours a case-insensitive allowlist before Cloudflare isSpam', () => {
		const decision = evaluateSpamPolicy(settings, [{ match_type: 'email', value: 'trusted@example.com', action: 'normal' }], 'TRUSTED@example.com', { isSpam: 1 });
		expect(decision).toMatchObject({ isSpam: 0, reasons: ['allowlist'] });
	});

	it('does not score preliminary none values when the safeguard is enabled', () => {
		const decision = evaluateSpamPolicy(settings, [], 'early@example.test', { isLastEvent: 0, isSpam: 0, spf: 'none', dkim: 'none', dmarc: 'none' });
		expect(decision).toMatchObject({ isSpam: 0, score: 0, suspiciousSignals: 0 });
	});

	it('requires the configured number of suspicious authentication signals', () => {
		const strict = { ...settings, spamThreshold: 4, spamMinSignals: 2, spamAuthWeights: JSON.stringify({ spf: { fail: 4 }, dkim: {}, dmarc: {} }) };
		const decision = evaluateSpamPolicy(strict, [], 'single-signal@example.test', { isLastEvent: 1, isSpam: 0, spf: 'fail', dkim: 'pass', dmarc: 'pass' });
		expect(decision).toMatchObject({ isSpam: 0, score: 4, suspiciousSignals: 1 });
	});
});
