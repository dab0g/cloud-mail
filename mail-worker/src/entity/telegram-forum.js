import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const telegramForumConfig = sqliteTable('telegram_forum_config', {
	id: integer('id').primaryKey(),
	enabled: integer('enabled').notNull().default(0),
	chatId: text('chat_id').notNull().default(''),
	defaultNormalThreadId: integer('default_normal_thread_id').notNull().default(0),
	defaultSpamThreadId: integer('default_spam_thread_id').notNull().default(0),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const telegramRecipientRoute = sqliteTable('telegram_recipient_route', {
	routeId: integer('route_id').primaryKey({ autoIncrement: true }),
	recipientEmail: text('recipient_email').notNull(),
	normalThreadId: integer('normal_thread_id').notNull().default(0),
	spamThreadId: integer('spam_thread_id').notNull().default(0),
	enabled: integer('enabled').notNull().default(1),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const cloudflareEmailZone = sqliteTable('cloudflare_email_zone', {
	zoneId: integer('id').primaryKey({ autoIncrement: true }),
	domain: text('domain').notNull(),
	cloudflareZoneId: text('cloudflare_zone_id').notNull(),
	enabled: integer('enabled').notNull().default(1),
	lastPolledAt: text('last_polled_at'),
});

export const emailSpamClassification = sqliteTable('email_spam_classification', {
	emailId: integer('email_id').primaryKey(),
	state: text('state').notNull().default('pending'),
	isSpam: integer('is_spam').notNull().default(0),
	provisional: integer('provisional').notNull().default(0),
	score: integer('score').notNull().default(0),
	reasons: text('reasons').notNull().default('[]'),
	spf: text('spf'),
	dkim: text('dkim'),
	dmarc: text('dmarc'),
	cloudflareIsSpam: integer('cloudflare_is_spam'),
	cloudflareIsLastEvent: integer('cloudflare_is_last_event').notNull().default(0),
	cloudflareEventAt: text('cloudflare_event_at'),
	nextRetryAt: text('next_retry_at'),
	classifiedAt: text('classified_at'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const telegramDelivery = sqliteTable('telegram_delivery', {
	deliveryId: integer('delivery_id').primaryKey({ autoIncrement: true }),
	emailId: integer('email_id').notNull(),
	kind: text('kind').notNull(),
	chatId: text('chat_id').notNull(),
	threadId: integer('thread_id').notNull(),
	telegramMessageId: integer('telegram_message_id'),
	state: text('state').notNull().default('sent'),
	lastError: text('last_error').notNull().default(''),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	deletedAt: text('deleted_at'),
});

export const spamSenderRule = sqliteTable('spam_sender_rule', {
	ruleId: integer('rule_id').primaryKey({ autoIncrement: true }),
	matchType: text('match_type').notNull(),
	value: text('value').notNull(),
	action: text('action').notNull(),
	enabled: integer('enabled').notNull().default(1),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
