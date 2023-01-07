import { Guild } from 'discord.js';
import { ClientEventHandler } from '../event-handler-types.js';
import { updateCommandsForSingleGuild } from '../../command-handling/update-commands.js';
import { ensureWebhookCorrectness } from '../../util/webhook-util.js';
import logger from '../../util/logger.js';
import { ensureGuildConfigurationExists, removeLeftTimestamp } from '../../storage/guild-config-dao.js';

const guildCreateEvent: ClientEventHandler<'guildCreate'> = {
	name: 'guildCreate',
	execute(guild: Guild) {
		handleGuildCreate(guild).catch(e => logger.error(e));
	}
};

async function handleGuildCreate(guild: Guild) {
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

				// When the bot gets removed from a guild and rejoins it, all webhooks and commands in Discord should be deleted.
				// So for this case we need to make sure they get recreated.
				await ensureWebhookCorrectness(guild.client, guild.id);
				await updateCommandsForSingleGuild(guild);
			}
		}
	} catch (error) {
		logger.error(
			error,
			'Error while trying to ensure configuration for guild %s exists after receving guild create event.',
			guild.id
		);
	}
}

export default guildCreateEvent;
