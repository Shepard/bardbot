import { Guild } from 'discord.js';
import { ClientEventHandler } from '../event-handler-types.js';
import { setGuildCommandsNotUpdated } from '../../command-handling/update-commands.js';
import { setLeftTimestamp } from '../../storage/guild-config-dao.js';
import logger from '../../util/logger.js';

const guildDeleteEvent: ClientEventHandler<'guildDelete'> = {
	name: 'guildDelete',
	execute(guild: Guild) {
		handleGuildDelete(guild);
	}
};

function handleGuildDelete(guild: Guild) {
	// If the bot got removed from a guild then the commands in there are lost as well.
	// So we need to make sure they will be updated again when the bot gets invited to that guild again.
	setGuildCommandsNotUpdated(guild.id);

	try {
		setLeftTimestamp(guild.id);
		logger.info(
			'Bot removed from guild %s. Recorded time for later deletion of guild data. Total guilds: %d',
			guild.id,
			guild.client.guilds.cache.size
		);
	} catch (error) {
		logger.error(
			error,
			'Error while trying to set left timestamp for guild %s after receving guild delete event.',
			guild.id
		);
	}
}

export default guildDeleteEvent;
