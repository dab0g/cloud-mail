import KvConst from '../const/kv-const';
import { settingConst } from '../const/entity-const';

export async function email(message, env) {
	if (!env?.kv || typeof env.kv.get !== 'function') {
		return reject(message, 'Forwarding configuration is unavailable');
	}

	let settings;
	try {
		settings = await env.kv.get(KvConst.SETTING, { type: 'json' });
	} catch (error) {
		console.error('Could not load email forwarding configuration', error);
		return reject(message, 'Forwarding configuration could not be loaded');
	}

	if (!settings || typeof settings !== 'object') {
		return reject(message, 'Email forwarding is not configured');
	}

	const destinations = typeof settings.forwardEmail === 'string'
		? settings.forwardEmail.split(',').map(address => address.trim()).filter(Boolean)
		: [];
	const forwardingEnabled = settings.forwardStatus !== undefined
		&& settings.forwardStatus !== null
		&& Number(settings.forwardStatus) === settingConst.forwardStatus.OPEN;

	if (!forwardingEnabled || destinations.length === 0) {
		return reject(message, 'Email forwarding is disabled or has no destination');
	}

	const results = await Promise.allSettled(destinations.map(destination => message.forward(destination)));
	const failures = [];
	results.forEach((result, index) => {
		if (result.status === 'rejected') {
			failures.push(destinations[index]);
			console.error(`Email forwarding failed for ${destinations[index]}`, result.reason);
		}
	});

	if (failures.length > 0) {
		throw new Error(`Email forwarding failed for: ${failures.join(', ')}`);
	}
}

function reject(message, reason) {
	console.error(reason);
	message.setReject(reason);
}
