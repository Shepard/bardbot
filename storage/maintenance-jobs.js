import schedule from 'node-schedule';
import { deleteOutdatedMessageMetadata } from './message-metadata-dao.js';
import { getGuildIdsForGuildsWithConfiguration } from './guild-config-dao.js';
import { ensureWebhookCorrectness } from '../util/webhook-util.js';
import logger from '../util/logger.js';

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
			logger.info('Daily cleanup of outdated message metadata removed %d record(s).', numChanges);
		} catch (e) {
			logger.error(e, 'Error while trying to run daily cleanup of outdated message metadata');
		}
	});
}

function addEnsureWebhookCorrectnessJob(client) {
	const rule = new schedule.RecurrenceRule();
	rule.hour = 6;
	rule.minute = 30;
	rule.tz = 'Etc/UTC';

	schedule.scheduleJob(rule, () => {
		logger.info('Ensuring webhook correctness for all guilds.');
		Promise.allSettled(
			// This is not the ideal list of all guilds we're in but it's probably good enough for this task.
			// The only thing it wouldn't catch is a guild with no configuration (maybe reset?) but superfluous webhooks - and that's no big deal.
			// We mainly want to make sure we're not missing any webhooks. Removing superfluous ones is just cleanliness.
			getGuildIdsForGuildsWithConfiguration().map(guildId => {
				return ensureWebhookCorrectness(client, guildId).catch(e => logger.error(e));
			})
		).catch(e => logger.error(e));
	});
}
