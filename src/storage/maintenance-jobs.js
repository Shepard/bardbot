import schedule from 'node-schedule';
import { deleteOutdatedMessageMetadata } from './message-metadata-dao.js';
import { getActiveGuildIds, deleteObsoleteGuildData } from './guild-config-dao.js';
import { ensureWebhookCorrectness } from '../util/webhook-util.js';
import { cleanupStories } from './story-dao.js';
import logger from '../util/logger.js';
import { areGuildCommandsUpdated, updateCommandsForSingleGuild } from '../command-handling/update-commands.js';
import { backupDatabase } from './database.js';
import config from '../util/config.js';

export function initMaintenanceJobs(client) {
	// TODO figure out best order and timing (considering scripts might want to copy the files elsewhere) and combine cleanup jobs.
	addDatabaseBackupJob();
	addDeleteObsoleteGuildDataJob();
	addDeleteOutdatedMessageMetadataJob();
	addEnsureGuildCommandsUpdatedJob(client);
	addEnsureWebhookCorrectnessJob(client);
	addCleanupStoriesJob();
}

function addDatabaseBackupJob() {
	if (!config.backup) {
		return;
	}

	const rule = new schedule.RecurrenceRule();
	rule.hour = 5;
	rule.minute = 0;
	rule.tz = 'Etc/UTC';

	schedule.scheduleJob(rule, () => {
		try {
			backupDatabase()
				.then(dbFileName => {
					logger.info('Database backup file %s created.', dbFileName);
				})
				.catch(error => logger.error(error, 'Error while trying to run daily backup of database'));
		} catch (e) {
			logger.error(e, 'Error while trying to run daily backup of database');
		}
	});
}

function addDeleteObsoleteGuildDataJob() {
	const rule = new schedule.RecurrenceRule();
	rule.hour = 5;
	rule.minute = 30;
	rule.tz = 'Etc/UTC';

	schedule.scheduleJob(rule, () => {
		// Delete all data for guilds that have been left over a day ago.
		// We need to delete data to comply with Discord Developer Policy: https://discord.com/developers/docs/policy
		//  "You may not use the APIs in any way to: [...] retain data any longer than necessary for the operation of your application"
		// But we don't want to delete everything immediately since the bot might've been removed unintentionally or temporarily or the guild owner might change their mind.
		// So the guild gets marked with a left_timestamp when we receive the event that the bot left the guild (or on startup when we find out we're no longer in it).
		// In this job we then finally remove their data then.

		// Theoretically there could be cases where we missed a guild create event and then would delete the data even though we rejoined.
		// But since we check on startup too, this seems unrealistic. We would have to fetch the guilds from Discord which seems unnecessary.

		try {
			// We clean up all stories of obsolete guilds first.
			// While the story records could be cleaned up via foreign keys when the guild_config records get deleted,
			// their files on the harddrive would not be removed along with that. So we do it in a separate step.
			cleanupStories(true, logger)
				.then(() => {
					const numGuildChanges = deleteObsoleteGuildData();
					if (numGuildChanges > 0) {
						logger.info('Daily cleanup of obsolete guild data removed %d record(s).', numGuildChanges);
					}
				})
				.catch(error => logger.error(error, 'Error while trying to run daily cleanup of obsolete guild data'));
		} catch (e) {
			logger.error(e, 'Error while trying to run daily cleanup of obsolete guild data');
		}
	});
}

function addDeleteOutdatedMessageMetadataJob() {
	const rule = new schedule.RecurrenceRule();
	rule.hour = 6;
	rule.minute = 0;
	rule.tz = 'Etc/UTC';

	schedule.scheduleJob(rule, () => {
		try {
			const numChanges = deleteOutdatedMessageMetadata();
			if (numChanges > 0) {
				logger.info('Daily cleanup of outdated message metadata removed %d record(s).', numChanges);
			}
		} catch (e) {
			logger.error(e, 'Error while trying to run daily cleanup of outdated message metadata');
		}
	});
}

function addEnsureGuildCommandsUpdatedJob(client) {
	const rule = new schedule.RecurrenceRule();
	rule.hour = 6;
	rule.minute = 15;
	rule.tz = 'Etc/UTC';

	schedule.scheduleJob(rule, () => {
		logger.info('Ensuring commands updated for all guilds.');
		Promise.allSettled(
			getActiveGuildIds()
				.filter(guildId => !areGuildCommandsUpdated(guildId))
				.map(guildId => client.guilds.cache.get(guildId))
				.filter(guild => !!guild)
				.map(guild => {
					return updateCommandsForSingleGuild(client, guild).catch(e => {
						logger.error(e, 'Error while trying to update commands for guild %s', guild.id);
					});
				})
		).catch(e => logger.error(e));
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
			getActiveGuildIds().map(guildId => {
				return ensureWebhookCorrectness(client, guildId).catch(e => logger.error(e));
			})
		).catch(e => logger.error(e));
	});
}

function addCleanupStoriesJob() {
	const rule = new schedule.RecurrenceRule();
	rule.hour = 7;
	rule.minute = 0;
	rule.tz = 'Etc/UTC';

	schedule.scheduleJob(rule, () => {
		try {
			cleanupStories(false, logger)
				.then(numChanges => {
					if (numChanges > 0) {
						logger.info('Daily cleanup of stories removed %d record(s).', numChanges);
					}
				})
				.catch(error => logger.error(error, 'Error while trying to run daily cleanup of stories'));
		} catch (error) {
			logger.error(error, 'Error while trying to run daily cleanup of stories');
		}
	});
}
