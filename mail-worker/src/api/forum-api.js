import app from '../hono/hono';
import result from '../model/result';
import forumService from '../service/forum-service';
import telegramService from '../service/telegram-service';

app.get('/forum/config', async c => c.json(result.ok(await forumService.config(c))));
app.put('/forum/config', async c => c.json(result.ok(await forumService.saveConfig(c, await c.req.json()))));

app.get('/forum/routes', async c => c.json(result.ok(await forumService.listRoutes(c))));
app.put('/forum/routes', async c => {
	await forumService.saveRoute(c, await c.req.json());
	return c.json(result.ok());
});
app.delete('/forum/routes/:routeId', async c => {
	await forumService.deleteRoute(c, c.req.param('routeId'));
	return c.json(result.ok());
});

app.get('/forum/zones', async c => c.json(result.ok(await forumService.listZones(c))));
app.put('/forum/zones', async c => {
	await forumService.saveZone(c, await c.req.json());
	return c.json(result.ok());
});
app.delete('/forum/zones/:zoneId', async c => {
	await forumService.deleteZone(c, c.req.param('zoneId'));
	return c.json(result.ok());
});

app.post('/forum/test', async c => {
	const { chatId, threadId } = await c.req.json();
	const messageId = await telegramService.testForumTopic(c, chatId, threadId);
	return c.json(result.ok({ messageId }));
});

app.get('/spam/rules', async c => {
	const rows = await c.env.db.prepare('SELECT * FROM spam_sender_rule ORDER BY action, match_type, value').all();
	return c.json(result.ok(rows.results));
});
app.put('/spam/rules', async c => {
	const params = await c.req.json();
	const value = String(params.value || '').trim().toLowerCase();
	if (!value || !['email', 'domain'].includes(params.matchType) || !['spam', 'normal'].includes(params.action)) throw new Error('Invalid spam sender rule');
	await c.env.db.prepare(`INSERT INTO spam_sender_rule (match_type, value, action, enabled) VALUES (?, ?, ?, ?)`)
		.bind(params.matchType, value, params.action, Number(params.enabled) === 0 ? 0 : 1).run();
	return c.json(result.ok());
});
app.delete('/spam/rules/:ruleId', async c => {
	await c.env.db.prepare('DELETE FROM spam_sender_rule WHERE rule_id = ?').bind(Number(c.req.param('ruleId'))).run();
	return c.json(result.ok());
});
