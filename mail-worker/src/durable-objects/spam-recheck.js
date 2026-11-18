// Keep the exported class for existing deployments; old alarms must not recheck mail.
export class SpamRecheck {
	constructor(ctx, env) {
		this.ctx = ctx;
		this.env = env;
	}

	async fetch(request) {
		return new Response('Spam rechecks are disabled', { status: 410 });
	}

	async alarm() {
		// Previously scheduled alarms expire without accessing D1 or rescheduling.
	}
}
