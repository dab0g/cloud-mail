import forumService from './forum-service';
import settingService from './setting-service';
import telegramService from './telegram-service';

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const FIVE_MINUTES = 5 * 60 * 1000;
const RECONCILE_WINDOW = 24 * 60 * 60 * 1000;

function value(row, field) { return String(row?.[field] || '').toLowerCase(); }
function ageMs(row) {
	const createdAt = new Date(`${row.classification_created_at || row.create_time}Z`).getTime();
	return Number.isFinite(createdAt) ? Date.now() - createdAt : 0;
}
function domainOf(address) { return String(address || '').split('@').pop().toLowerCase(); }
function messageId(value) { return String(value || '').trim().replace(/^<|>$/g, '').toLowerCase(); }

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
	let score = 0;
	const add = (name, status, entries) => {
		const weight = entries[status] || 0;
		if (weight) { score += weight; reasons.push(`${name}:${status}(+${weight})`); }
	};
	add('spf', value(event, 'spf'), { softfail: Number(settings.spamSpfSoftfail), none: Number(settings.spamSpfNone), fail: Number(settings.spamSpfFail) });
	add('dkim', value(event, 'dkim'), { none: Number(settings.spamDkimNone), fail: Number(settings.spamDkimFail) });
	add('dmarc', value(event, 'dmarc'), { none: Number(settings.spamDmarcNone), fail: Number(settings.spamDmarcFail) });
	return { isSpam: score >= Number(settings.spamThreshold) ? 1 : 0, score, reasons };
}

const spamService = {
	async createPending(c, emailId) {
		await c.env.db.prepare(`INSERT OR IGNORE INTO email_spam_classification (email_id, state, next_retry_at) VALUES (?, 'pending', CURRENT_TIMESTAMP)`)
			.bind(emailId).run();
	},

	async policy(c, sender, event) {
		const settings = await settingService.query(c);
		const rules = await c.env.db.prepare('SELECT * FROM spam_sender_rule WHERE enabled = 1').all().then(r => r.results);
		return evaluateSpamPolicy(settings, rules, sender, event);
	},

	async queryZoneEvents(env, zoneId, start) {
		const token = env.CF_EMAIL_ANALYTICS_TOKEN;
		if (!token) return [];
		const query = `query Events($zoneTag: string!, $start: Time!, $end: Time!) { viewer { zones(filter: { zoneTag: $zoneTag }) { emailRoutingAdaptive(filter: { datetime_geq: $start, datetime_leq: $end }, limit: 10000, orderBy: [datetime_DESC]) { datetime from to subject status messageId dkim dmarc spf isSpam } } } }`;
		const response = await fetch(GRAPHQL_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { zoneTag: zoneId, start, end: new Date().toISOString() } }) });
		if (!response.ok) throw new Error(`Cloudflare GraphQL request failed (${response.status})`);
		const payload = await response.json();
		if (payload.errors?.length) throw new Error('Cloudflare GraphQL returned errors');
		return payload.data?.viewer?.zones?.[0]?.emailRoutingAdaptive || [];
	},

	async pending(c) {
		return c.env.db.prepare(`SELECT e.*, s.state AS spam_state, s.provisional AS spam_provisional, s.created_at AS classification_created_at FROM email e JOIN email_spam_classification s ON s.email_id = e.email_id WHERE s.state IN ('pending', 'provisional_normal') AND datetime(s.created_at) >= datetime('now', '-24 hours') ORDER BY e.email_id LIMIT 200`).all().then(r => r.results);
	},

	async recordClassification(c, emailRow, decision, event, provisional = false) {
		await c.env.db.prepare(`UPDATE email_spam_classification SET state = ?, is_spam = ?, provisional = ?, score = ?, reasons = ?, spf = ?, dkim = ?, dmarc = ?, cloudflare_is_spam = ?, cloudflare_event_at = ?, classified_at = CURRENT_TIMESTAMP, next_retry_at = CURRENT_TIMESTAMP WHERE email_id = ?`)
			.bind(provisional ? 'provisional_normal' : 'classified', decision.isSpam, provisional ? 1 : 0, decision.score, JSON.stringify(decision.reasons), event?.spf || null, event?.dkim || null, event?.dmarc || null, event ? Number(event.isSpam || 0) : null, event?.datetime || null, emailRow.email_id).run();
		await c.env.db.prepare('UPDATE email SET is_spam = ? WHERE email_id = ?').bind(provisional ? 0 : decision.isSpam, emailRow.email_id).run();
	},

	async activeDelivery(c, emailId, kind) {
		return c.env.db.prepare(`SELECT * FROM telegram_delivery WHERE email_id = ? AND kind = ? ORDER BY delivery_id DESC LIMIT 1`).bind(emailId, kind).first();
	},

	async deliver(c, emailRow, decision, classification, kind) {
		const destination = await forumService.destination(c, emailRow.to_email, kind === 'spam');
		if (!destination) throw new Error('Telegram forum routing is not fully configured');
		let delivery = await this.activeDelivery(c, emailRow.email_id, kind);
		if (delivery?.state === 'sent' || delivery?.state === 'deleted' || delivery?.state === 'delete_failed') return;
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
		if ((await this.activeDelivery(c, emailRow.email_id, 'spam'))?.state === 'sent') return;
		await this.deliver(c, emailRow, decision, classification, 'spam');
		const normal = await this.activeDelivery(c, emailRow.email_id, 'normal');
		if (normal?.state !== 'sent' || !normal.telegram_message_id) return;
		try {
			await telegramService.deleteForumMessage(c, normal.chat_id, normal.telegram_message_id);
			await c.env.db.prepare(`UPDATE telegram_delivery SET state = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE delivery_id = ?`).bind(normal.delivery_id).run();
		} catch (error) {
			await c.env.db.prepare(`UPDATE telegram_delivery SET state = 'delete_failed', last_error = ? WHERE delivery_id = ?`).bind(String(error.message || 'delete failed').slice(0, 500), normal.delivery_id).run();
		}
	},

	async process(c) {
		if (!await forumService.isEnabled(c)) return;
		const rows = await this.pending(c);
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
				if (event) {
					const decision = await this.policy(c, row.send_email, event);
					const classification = { ...decision, event };
					const wasProvisionalNormal = row.spam_state === 'provisional_normal';
					await this.recordClassification(c, row, decision, event);
					if (wasProvisionalNormal && decision.isSpam) await this.relocateToSpam(c, row, decision, classification);
					else await this.deliver(c, row, decision, classification, decision.isSpam ? 'spam' : 'normal');
					continue;
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
	}
};

export default spamService;
