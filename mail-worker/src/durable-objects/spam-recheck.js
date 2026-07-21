import spamService from '../service/spam-service';

// A Durable Object alarm is persistent, unlike an in-process timer. It lets us
// recheck one message soon after Email Routing has written its analytics event.
const FAST_RECHECK_DELAY_MS = 20 * 1000;

export class SpamRecheck {
	constructor(ctx, env) {
		this.ctx = ctx;
		this.env = env;
	}

	async fetch(request) {
		if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
		const emailId = Number(new URL(request.url).searchParams.get('emailId'));
		if (!Number.isInteger(emailId) || emailId <= 0) return new Response('Invalid email ID', { status: 400 });
		await this.ctx.storage.put('emailId', emailId);
		await this.ctx.storage.setAlarm(Date.now() + FAST_RECHECK_DELAY_MS);
		return new Response(null, { status: 204 });
	}

	async alarm() {
		const emailId = Number(await this.ctx.storage.get('emailId'));
		if (!Number.isInteger(emailId) || emailId <= 0) return;
		await spamService.processEmail({ env: this.env }, emailId);
		await this.ctx.storage.delete('emailId');
	}
}
