const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizedEmail(value) {
	return String(value || '').trim().toLowerCase();
}

function positiveInt(value) {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? number : 0;
}

const forumService = {
	async config(c) {
		return c.env.db.prepare('SELECT * FROM telegram_forum_config WHERE id = 1').first();
	},

	async isEnabled(c) {
		const config = await this.config(c);
		return !!(config?.enabled && config.chat_id && positiveInt(config.default_normal_thread_id) && positiveInt(config.default_spam_thread_id));
	},

	async saveConfig(c, params) {
		const chatId = String(params.chatId || '').trim();
		const normal = positiveInt(params.defaultNormalThreadId);
		const spam = positiveInt(params.defaultSpamThreadId);
		if (Number(params.enabled) === 1 && (!chatId || !normal || !spam)) throw new Error('Forum chat and both fallback topics are required');
		await c.env.db.prepare(`UPDATE telegram_forum_config SET enabled = ?, chat_id = ?, default_normal_thread_id = ?, default_spam_thread_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
			.bind(Number(params.enabled) ? 1 : 0, chatId, normal, spam).run();
		return this.config(c);
	},

	async listRoutes(c) {
		return c.env.db.prepare('SELECT * FROM telegram_recipient_route ORDER BY recipient_email').all().then(r => r.results);
	},

	async saveRoute(c, params) {
		const recipientEmail = normalizedEmail(params.recipientEmail);
		if (!emailPattern.test(recipientEmail)) throw new Error('A valid recipient email is required');
		const normal = positiveInt(params.normalThreadId);
		const spam = positiveInt(params.spamThreadId);
		if (!normal || !spam) throw new Error('Both normal and spam topic IDs are required');
		await c.env.db.prepare(`INSERT INTO telegram_recipient_route (recipient_email, normal_thread_id, spam_thread_id, enabled, updated_at)
			VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(recipient_email) DO UPDATE SET normal_thread_id = excluded.normal_thread_id, spam_thread_id = excluded.spam_thread_id, enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP`)
			.bind(recipientEmail, normal, spam, Number(params.enabled) === 0 ? 0 : 1).run();
	},

	async deleteRoute(c, routeId) {
		await c.env.db.prepare('DELETE FROM telegram_recipient_route WHERE route_id = ?').bind(Number(routeId)).run();
	},

	async listZones(c) {
		return c.env.db.prepare('SELECT * FROM cloudflare_email_zone ORDER BY domain').all().then(r => r.results);
	},

	async saveZone(c, params) {
		const domain = String(params.domain || '').trim().toLowerCase().replace(/^@/, '');
		const cloudflareZoneId = String(params.cloudflareZoneId || '').trim();
		if (!domain || !cloudflareZoneId) throw new Error('Domain and Cloudflare Zone ID are required');
		await c.env.db.prepare(`INSERT INTO cloudflare_email_zone (domain, cloudflare_zone_id, enabled)
			VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET cloudflare_zone_id = excluded.cloudflare_zone_id, enabled = excluded.enabled`)
			.bind(domain, cloudflareZoneId, Number(params.enabled) === 0 ? 0 : 1).run();
	},

	async deleteZone(c, zoneId) {
		await c.env.db.prepare('DELETE FROM cloudflare_email_zone WHERE id = ?').bind(Number(zoneId)).run();
	},

	async destination(c, recipientEmail, isSpam) {
		const config = await this.config(c);
		if (!config?.enabled) return null;
		const route = await c.env.db.prepare('SELECT * FROM telegram_recipient_route WHERE recipient_email = ? COLLATE NOCASE AND enabled = 1')
			.bind(normalizedEmail(recipientEmail)).first();
		const threadId = positiveInt(isSpam ? route?.spam_thread_id || config.default_spam_thread_id : route?.normal_thread_id || config.default_normal_thread_id);
		if (!config.chat_id || !threadId) return null;
		return { chatId: config.chat_id, threadId };
	}
};

export default forumService;
