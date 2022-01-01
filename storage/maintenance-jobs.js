import schedule from 'node-schedule';
import { deleteOutdatedMessageMetadata } from './message-metadata-dao.js';
import { getGuildIdsForGuildsWithConfiguration } from './guild-config-dao.js';
import { ensureWebhookCorrectness } from '../util/webhook-util.js';

export function initMaintenanceJobs(client) {
	addDeleteOutdatedMessageMetadataJob();
	addEnsureWebhookCorrectnessJob(client);
}

function addDeleteOutdatedMessageMetadataJob() {
	const rule = new schedule.RecurrenceRule();
	rule.hour = 6;
	rule.minute = 0;
	rule.tz = 'Etc/UTC';

	schedule.scheduleJob(rule, () => {
		try {
			const numChanges = deleteOutdatedMessageMetadata();
			console.log(`Daily cleanup of outdated message metadata removed ${numChanges} record(s).`);
		} catch (e) {
			console.error('Error while trying to run daily cleanup of outdated message metadata:', e);
		}
	});
}

function addEnsureWebhookCorrectnessJob(client) {
	const rule = new schedule.RecurrenceRule();
	rule.hour = 6;
	rule.minute = 30;
	rule.tz = 'Etc/UTC';

	schedule.scheduleJob(rule, () => {
		console.log('Ensuring webhook correctness for all guilds.');
		Promise.allSettled(
			// This is not the ideal list of all guilds we're in but it's probably good enough for this task.
			// The only thing it wouldn't catch is a guild with no configuration (maybe reset?) but superfluous webhooks - and that's no big deal.
			// We mainly want to make sure we're not missing any webhooks. Removing superfluous ones is just cleanliness.
			getGuildIdsForGuildsWithConfiguration().map(guildId => {
				return ensureWebhookCorrectness(client, guildId).catch(e => console.error(e));
			})
		).catch(e => console.error(e));
	});
}
