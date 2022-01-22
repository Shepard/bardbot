import { updateCommandsForSingleGuild, areGuildCommandsUpdated } from '../command-handling/update-commands.js';
import { ensureWebhookCorrectness } from '../util/webhook-util.js';
import logger from '../util/logger.js';

const guildCreateEvent = {
	name: 'guildCreate',
	execute(guild) {
		handleGuildCreate(guild).catch(e => logger.error(e));
	}
};

async function handleGuildCreate(guild) {
	if (!areGuildCommandsUpdated(guild.id)) {
		logger.info('Updating commands for guild %s after receiving guild create event.', guild.id);
		await updateCommandsForSingleGuild(guild.client, guild);
	}

	// When the bot gets removed from a guild and rejoins it, all webhooks in Discord should be deleted.
	// So for this case we need to make sure they get recreated.
	await ensureWebhookCorrectness(guild.client, guild.id);
}

export default guildCreateEvent;
