import { updateCommandsForSingleGuild, areGuildCommandsUpdated } from '../command-handling/update-commands.js';
import { ensureWebhookCorrectness } from '../util/webhook-util.js';
import logger from '../util/logger.js';
import { ensureGuildConfigurationExists, removeLeftTimestamp } from '../storage/guild-config-dao.js';

const guildCreateEvent = {
	name: 'guildCreate',
	execute(guild) {
		handleGuildCreate(guild).catch(e => logger.error(e));
	}
};

async function handleGuildCreate(guild) {
	try {
		const added = ensureGuildConfigurationExists(guild.id);
		if (added) {
			logger.info('Joined guild %s. Total guilds: %d', guild.id, guild.client.guilds.cache.size);
		} else {
			const removedTimestamp = removeLeftTimestamp(guild.id);
			if (removedTimestamp) {
				logger.info(
					'Rejoined guild %s. Removed left time so guild data will not be deleted. Total guilds: %d',
					guild.id,
					guild.client.guilds.cache.size
				);

				// When the bot gets removed from a guild and rejoins it, all webhooks in Discord should be deleted.
				// So for this case we need to make sure they get recreated.
				await ensureWebhookCorrectness(guild.client, guild.id);
			}
		}
	} catch (error) {
		logger.error(
			error,
			'Error while trying to ensure configuration for guild %s exists after receving guild create event.',
			guild.id
		);
	}

	if (!areGuildCommandsUpdated(guild.id)) {
		logger.info('Updating commands for guild %s after receiving guild create event.', guild.id);
		await updateCommandsForSingleGuild(guild.client, guild);
	}
}

export default guildCreateEvent;
