import orm from '../entity/orm';
import email from '../entity/email';
import settingService from './setting-service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
import { eq } from 'drizzle-orm';
import jwtUtils from '../utils/jwt-utils';
import emailMsgTemplate from '../template/email-msg';
import emailTextTemplate from '../template/email-text';
import emailHtmlTemplate from '../template/email-html';
import verifyUtils from '../utils/verify-utils';
import domainUtils from "../utils/domain-uitls";

const telegramService = {

	async getEmailContent(c, params) {

		const { token } = params

		const result = await jwtUtils.verifyToken(c, token);

		if (!result) {
			return emailTextTemplate('Access denied')
		}

		const emailRow = await orm(c).select().from(email).where(eq(email.emailId, result.emailId)).get();

		if (emailRow) {

			if (emailRow.content) {
				const { r2Domain } = await settingService.query(c);
				return emailHtmlTemplate(emailRow.content || '', r2Domain)
			} else {
				return emailTextTemplate(emailRow.text || '')
			}

		} else {
			return emailTextTemplate('The email does not exist')
		}

	},

	async sendEmailToBot(c, email) {

		const { tgBotToken, tgChatId, customDomain, tgMsgTo, tgMsgFrom, tgMsgText } = await settingService.query(c);

		const tgChatIds = tgChatId.split(',');

		const jwtToken = await jwtUtils.generateToken(c, { emailId: email.emailId })

		const webAppUrl = customDomain ? `${domainUtils.toOssDomain(customDomain)}/api/telegram/getEmail/${jwtToken}` : 'https://www.cloudflare.com/404'
		const inlineKeyboard = [
			[
				{
					text: 'View',
					web_app: { url: webAppUrl }
				}
			]
		];

		if (email.code) {
			inlineKeyboard.push([
				{
					text: email.code,
					copy_text: { text: email.code }
				}
			]);
		}

		await Promise.all(tgChatIds.map(async chatId => {
			try {
				const res = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						chat_id: chatId,
						parse_mode: 'HTML',
						text: emailMsgTemplate(email, tgMsgTo, tgMsgFrom, tgMsgText),
						reply_markup: {
							inline_keyboard: inlineKeyboard
						}
					})
				});
				if (!res.ok) {
					console.error(`转发 Telegram 失败 status: ${res.status} response: ${await res.text()}`);
				}
			} catch (e) {
				console.error(`转发 Telegram 失败:`, e.message);
			}
		}));

	},

	async sendEmailToForum(c, email, destination, classification = {}) {
		const { tgBotToken, customDomain, tgMsgTo, tgMsgFrom, tgMsgText } = await settingService.query(c);
		if (!tgBotToken) throw new Error('Telegram bot token is not configured');
		const jwtToken = await jwtUtils.generateToken(c, { emailId: email.emailId || email.email_id });
		const webAppUrl = customDomain ? `${domainUtils.toOssDomain(customDomain)}/api/telegram/getEmail/${jwtToken}` : 'https://www.cloudflare.com/404';
		const inlineKeyboard = [[{ text: 'View', web_app: { url: webAppUrl } }]];
		if (email.code) inlineKeyboard.push([{ text: email.code, copy_text: { text: email.code } }]);
		let text = emailMsgTemplate(email, tgMsgTo, tgMsgFrom, tgMsgText);
		if (classification.isSpam) {
			const event = classification.event || {};
			text = `⚠️ <b>SPAM</b> (score: ${classification.score || 0})\n${text}\n\nSPF: ${event.spf || 'unknown'} | DKIM: ${event.dkim || 'unknown'} | DMARC: ${event.dmarc || 'unknown'}\n${(classification.reasons || []).join(', ')}`.slice(0, 4096);
		}
		const response = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ chat_id: destination.chatId, message_thread_id: destination.threadId, parse_mode: 'HTML', text, reply_markup: { inline_keyboard: inlineKeyboard } })
		});
		const payload = await response.json();
		if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram send failed (${response.status})`);
		return { messageId: payload.result.message_id };
	},

	async deleteForumMessage(c, chatId, messageId) {
		const { tgBotToken } = await settingService.query(c);
		const response = await fetch(`https://api.telegram.org/bot${tgBotToken}/deleteMessage`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId) })
		});
		const payload = await response.json();
		if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram delete failed (${response.status})`);
	},

	async testForumTopic(c, chatId, threadId) {
		const { tgBotToken } = await settingService.query(c);
		if (!tgBotToken) throw new Error('Telegram bot token is not configured');
		const response = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(chatId), message_thread_id: Number(threadId), text: 'Cloud Mail forum routing test' })
		});
		const payload = await response.json();
		if (!response.ok || !payload.ok) throw new Error(payload.description || 'Telegram topic test failed');
		return payload.result.message_id;
	}

}

export default telegramService
