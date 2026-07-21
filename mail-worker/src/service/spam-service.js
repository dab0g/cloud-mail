import forumService from './forum-service';
import settingService from './setting-service';
import telegramService from './telegram-service';

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const FIVE_MINUTES = 5 * 60 * 1000;
const RECONCILE_WINDOW = 24 * 60 * 60 * 1000;
export const DEFAULT_AUTH_WEIGHTS = {
	spf: { pass: 0, none: 2, softfail: 2, fail: 4, temperror: 1, permerror: 3, unknown: 0 },
	dkim: { pass: 0, none: 2, softfail: 0, fail: 4, temperror: 1, permerror: 3, unknown: 0 },
	dmarc: { pass: 0, none: 2, softfail: 0, fail: 4, temperror: 1, permerror: 3, unknown: 0 }
};

function value(row, field) { return String(row?.[field] || '').toLowerCase(); }
function ageMs(row) {
	const createdAt = new Date(`${row.classification_created_at || row.create_time}Z`).getTime();
	return Number.isFinite(createdAt) ? Date.now() - createdAt : 0;
}
function domainOf(address) { return String(address || '').split('@').pop().toLowerCase(); }
function messageId(value) { return String(value || '').trim().replace(/^<|>$/g, '').toLowerCase(); }
function isFinal(event) { return Number(event?.isLastEvent) === 1; }
function eventIsNewer(row, event) {
	if (!row.cloudflare_event_at) return true;
	const eventTime = new Date(event.datetime).getTime();
	const storedTime = new Date(row.cloudflare_event_at).getTime();
	return eventTime > storedTime || (eventTime === storedTime && isFinal(event) && !Number(row.cloudflare_is_last_event));
}
function authWeights(settings) {
	try {
		const parsed = JSON.parse(settings.spamAuthWeights || '');
		if (parsed?.spf && parsed?.dkim && parsed?.dmarc) return parsed;
	} catch (_) { /* Use migrated legacy settings below. */ }
	return {
		spf: { ...DEFAULT_AUTH_WEIGHTS.spf, softfail: Number(settings.spamSpfSoftfail), none: Number(settings.spamSpfNone), fail: Number(settings.spamSpfFail) },
		dkim: { ...DEFAULT_AUTH_WEIGHTS.dkim, none: Number(settings.spamDkimNone), fail: Number(settings.spamDkimFail) },
		dmarc: { ...DEFAULT_AUTH_WEIGHTS.dmarc, none: Number(settings.spamDmarcNone), fail: Number(settings.spamDmarcFail) }
	};
}

/** Pure policy evaluator: its order is the documented spam-list → allowlist →
 * Cloudflare isSpam → weighted authentication results. */
export function evaluateSpamPolicy(settings, rules, sender, event) {
	if (!Number(settings.spamEnabled)) return { isSpam: 0, score: 0, reasons: ['spam-policy-disabled'] };
	const senderLower = String(sender || '').toLowerCase();
	const senderDomain = domainOf(senderLower);
	const matches = (rule) => rule.match_type === 'email' ? String(rule.value).toLowerCase() === senderLower : String(rule.value).toLowerCase() === senderDomain;
	const forcedSpam = rules.find(rule => rule.action === 'spam' && matches(rule));
	const forcedNormal = rules.find(rule => rule.action === 'normal' && matches(rule));
	const reasons = [];
	if (forcedSpam) return { isSpam: 1, score: Number(settings.spamThreshold), reasons: ['spam-list'] };
	if (forcedNormal) return { isSpam: 0, score: 0, reasons: ['allowlist'] };
	if (Number(settings.spamCfIsSpam) && Number(event.isSpam)) return { isSpam: 1, score: Number(settings.spamThreshold), reasons: ['cloudflare:isSpam'] };
	const weights = authWeights(settings);
	let score = 0;
	let suspiciousSignals = 0;
	const add = (name, status, entries) => {
		if (!isFinal(event) && Number(settings.spamIgnoreNonfinalNone) && status === 'none') {
			reasons.push(`${name}:none(ignored-before-final)`);
			return;
		}
		const weight = entries[status] || 0;
		if (weight) {
			score += weight;
			if (weight > 0) suspiciousSignals += 1;
			reasons.push(`${name}:${status}(${weight > 0 ? '+' : ''}${weight})`);
		}
	};
	add('spf', value(event, 'spf'), weights.spf || {});
	add('dkim', value(event, 'dkim'), weights.dkim || {});
	add('dmarc', value(event, 'dmarc'), weights.dmarc || {});
	return { isSpam: score >= Number(settings.spamThreshold) && suspiciousSignals >= Math.max(1, Number(settings.spamMinSignals || 1)) ? 1 : 0, score, reasons, suspiciousSignals };
}

const spamService = {
	async createPending(c, emailId) {
		await c.env.db.prepare(`INSERT OR IGNORE INTO email_spam_classification (email_id, state, next_retry_at) VALUES (?, 'pending', CURRENT_TIMESTAMP)`)
			.bind(emailId).run();
	},

	async scheduleFastRecheck(c, emailId) {
		if (!c.env.SPAM_RECHECK) return;
		const id = c.env.SPAM_RECHECK.idFromName(`email:${emailId}`);
		await c.env.SPAM_RECHECK.get(id).fetch(`https://spam-recheck/schedule?emailId=${encodeURIComponent(emailId)}`, { method: 'POST' });
	},

	async policy(c, sender, event) {
		const settings = await settingService.query(c);
		const rules = await c.env.db.prepare('SELECT * FROM spam_sender_rule WHERE enabled = 1').all().then(r => r.results);
		return evaluateSpamPolicy(settings, rules, sender, event);
	},

	async queryZoneEvents(env, zoneId, start) {
		const token = env.CF_EMAIL_ANALYTICS_TOKEN;
		if (!token) return [];
		const query = `query Events($zoneTag: string!, $start: Time!, $end: Time!) { viewer { zones(filter: { zoneTag: $zoneTag }) { emailRoutingAdaptive(filter: { datetime_geq: $start, datetime_leq: $end }, limit: 10000, orderBy: [datetime_DESC]) { datetime from to subject status messageId dkim dmarc spf isSpam isLastEvent } } } }`;
		const response = await fetch(GRAPHQL_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { zoneTag: zoneId, start, end: new Date().toISOString() } }) });
		if (!response.ok) throw new Error(`Cloudflare GraphQL request failed (${response.status})`);
		const payload = await response.json();
		if (payload.errors?.length) throw new Error('Cloudflare GraphQL returned errors');
		return payload.data?.viewer?.zones?.[0]?.emailRoutingAdaptive || [];
	},

	async pending(c, emailId = null) {
		const baseSql = `SELECT e.*, s.state AS spam_state, s.provisional AS spam_provisional, s.created_at AS classification_created_at, s.cloudflare_event_at, s.cloudflare_is_last_event FROM email e JOIN email_spam_classification s ON s.email_id = e.email_id WHERE s.state IN ('pending', 'provisional_normal', 'classified') AND datetime(s.created_at) >= datetime('now', '-24 hours')`;
		const query = emailId ? c.env.db.prepare(`${baseSql} AND e.email_id = ? ORDER BY e.email_id LIMIT 1`).bind(emailId) : c.env.db.prepare(`${baseSql} ORDER BY e.email_id LIMIT 200`);
		return query.all().then(r => r.results);
	},

	async recordClassification(c, emailRow, decision, event, provisional = false) {
		await c.env.db.prepare(`UPDATE email_spam_classification SET state = ?, is_spam = ?, provisional = ?, score = ?, reasons = ?, spf = COALESCE(?, spf), dkim = COALESCE(?, dkim), dmarc = COALESCE(?, dmarc), cloudflare_is_spam = COALESCE(?, cloudflare_is_spam), cloudflare_is_last_event = COALESCE(?, cloudflare_is_last_event), cloudflare_event_at = COALESCE(?, cloudflare_event_at), classified_at = CURRENT_TIMESTAMP, next_retry_at = CURRENT_TIMESTAMP WHERE email_id = ?`)
			.bind(provisional ? 'provisional_normal' : 'classified', decision.isSpam, provisional ? 1 : 0, decision.score, JSON.stringify(decision.reasons), event?.spf || null, event?.dkim || null, event?.dmarc || null, event ? Number(event.isSpam || 0) : null, event ? Number(isFinal(event)) : null, event?.datetime || null, emailRow.email_id).run();
		await c.env.db.prepare('UPDATE email SET is_spam = ? WHERE email_id = ?').bind(provisional ? 0 : decision.isSpam, emailRow.email_id).run();
	},

	async recordObservation(c, emailRow, event) {
		await c.env.db.prepare(`UPDATE email_spam_classification SET spf = ?, dkim = ?, dmarc = ?, cloudflare_is_spam = ?, cloudflare_is_last_event = ?, cloudflare_event_at = ?, next_retry_at = CURRENT_TIMESTAMP WHERE email_id = ?`)
			.bind(event.spf || null, event.dkim || null, event.dmarc || null, Number(event.isSpam || 0), Number(isFinal(event)), event.datetime, emailRow.email_id).run();
	},

	async activeDelivery(c, emailId, kind) {
		return c.env.db.prepare(`SELECT * FROM telegram_delivery WHERE email_id = ? AND kind = ? ORDER BY delivery_id DESC LIMIT 1`).bind(emailId, kind).first();
	},

	async deliver(c, emailRow, decision, classification, kind) {
		const destination = await forumService.destination(c, emailRow.to_email, kind === 'spam');
		if (!destination) throw new Error('Telegram forum routing is not fully configured');
		let delivery = await this.activeDelivery(c, emailRow.email_id, kind);
		if (delivery?.state === 'sent' || delivery?.state === 'delete_failed') return;
		if (delivery?.state === 'sending') return;
		if (delivery) {
			await c.env.db.prepare(`UPDATE telegram_delivery SET state = 'sending', chat_id = ?, thread_id = ?, telegram_message_id = NULL, last_error = '' WHERE delivery_id = ?`)
				.bind(destination.chatId, destination.threadId, delivery.delivery_id).run();
		} else {
			const claim = await c.env.db.prepare(`INSERT OR IGNORE INTO telegram_delivery (email_id, kind, chat_id, thread_id, state) VALUES (?, ?, ?, ?, 'sending')`)
				.bind(emailRow.email_id, kind, destination.chatId, destination.threadId).run();
			if (!claim.meta.changes) return;
			delivery = await this.activeDelivery(c, emailRow.email_id, kind);
		}
		const telegramEmail = { ...emailRow, emailId: emailRow.email_id, toEmail: emailRow.to_email, sendEmail: emailRow.send_email, toName: emailRow.to_name };
		try {
			const result = await telegramService.sendEmailToForum(c, telegramEmail, destination, classification);
			await c.env.db.prepare(`UPDATE telegram_delivery SET telegram_message_id = ?, state = 'sent' WHERE delivery_id = ?`)
				.bind(result.messageId, delivery.delivery_id).run();
		} catch (error) {
			await c.env.db.prepare(`UPDATE telegram_delivery SET state = 'failed', last_error = ? WHERE delivery_id = ?`)
				.bind(String(error.message || 'Telegram send failed').slice(0, 500), delivery.delivery_id).run();
			throw error;
		}
	},

	async relocateToSpam(c, emailRow, decision, classification) {
		await this.reconcileDelivery(c, emailRow, decision, classification);
	},

	async deleteDelivery(c, delivery) {
		if (delivery?.state !== 'sent' || !delivery.telegram_message_id) return;
		try {
			await telegramService.deleteForumMessage(c, delivery.chat_id, delivery.telegram_message_id);
			await c.env.db.prepare(`UPDATE telegram_delivery SET state = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE delivery_id = ?`).bind(delivery.delivery_id).run();
		} catch (error) {
			await c.env.db.prepare(`UPDATE telegram_delivery SET state = 'delete_failed', last_error = ? WHERE delivery_id = ?`).bind(String(error.message || 'delete failed').slice(0, 500), delivery.delivery_id).run();
		}
	},

	async reconcileDelivery(c, emailRow, decision, classification) {
		const desired = decision.isSpam ? 'spam' : 'normal';
		const opposite = decision.isSpam ? 'normal' : 'spam';
		await this.deliver(c, emailRow, decision, classification, desired);
		await this.deleteDelivery(c, await this.activeDelivery(c, emailRow.email_id, opposite));
	},

	async processRows(c, rows) {
		if (!rows.length) return;
		const zones = await forumService.listZones(c);
		const eventsByMessageId = new Map();
		for (const zone of zones.filter(zone => zone.enabled)) {
			try {
				const events = await this.queryZoneEvents(c.env, zone.cloudflare_zone_id, new Date(Date.now() - RECONCILE_WINDOW).toISOString());
				events.filter(event => event.messageId).forEach(event => {
					const key = messageId(event.messageId);
					if (!eventsByMessageId.has(key)) eventsByMessageId.set(key, event);
				});
				await c.env.db.prepare('UPDATE cloudflare_email_zone SET last_polled_at = CURRENT_TIMESTAMP WHERE id = ?').bind(zone.id).run();
			} catch (error) { console.error('Cloudflare email analytics sync failed', error.message); }
		}
		for (const row of rows) {
			try {
				const event = eventsByMessageId.get(messageId(row.message_id));
				if (event && eventIsNewer(row, event)) {
					const settings = await settingService.query(c);
					if (Number(settings.spamFinalOnly) && !isFinal(event)) {
						await this.recordObservation(c, row, event);
					} else {
						const decision = await this.policy(c, row.send_email, event);
						const classification = { ...decision, event };
						const wasProvisionalNormal = row.spam_state === 'provisional_normal';
						await this.recordClassification(c, row, decision, event);
						if (wasProvisionalNormal && decision.isSpam) await this.relocateToSpam(c, row, decision, classification);
						else await this.reconcileDelivery(c, row, decision, classification);
						continue;
					}
				}
				if (row.spam_state === 'pending' && ageMs(row) >= FIVE_MINUTES) {
					const decision = { isSpam: 0, score: 0, reasons: ['cloudflare-log-missing-after-5m'] };
					const classification = { ...decision, event: null, provisional: true };
					await this.recordClassification(c, row, decision, null, true);
					await this.deliver(c, row, decision, classification, 'normal');
				}
			} catch (error) {
				// Keep the classification retryable after a transient Telegram failure.
				await c.env.db.prepare(`UPDATE email_spam_classification SET state = 'pending', provisional = 0 WHERE email_id = ?`).bind(row.email_id).run();
				console.error('Telegram spam delivery failed', row.email_id, error.message);
			}
		}
	},

	async processEmail(c, emailId) {
		if (!await forumService.isEnabled(c)) return;
		await this.processRows(c, await this.pending(c, emailId));
	},

	async process(c) {
		if (!await forumService.isEnabled(c)) return;
		await this.processRows(c, await this.pending(c));
	}
};

export default spamService;
