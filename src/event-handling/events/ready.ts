import { Client } from 'discord.js';
import process from 'process';
import { ClientEventHandler } from '../event-handler-types.js';
import { setGuildCommandsUpdated, updateCommandsForSingleGuild } from '../../command-handling/update-commands.js';
import { initMaintenanceJobs } from '../../storage/maintenance-jobs.js';
import { syncGuilds } from '../../storage/guild-config-dao.js';
import logger from '../../util/logger.js';
import { ensureWebhookCorrectness } from '../../util/webhook-util.js';

const readyEvent: ClientEventHandler<'ready'> = {
	name: 'ready',
	once: true,
	execute(client: Client) {
		handleReady(client).catch(e => logger.error(e));
	}
};

async function handleReady(client: Client) {
	logger.info('Client is connected. Logged in as %s serving %d guilds.', client.user.tag, client.guilds.cache.size);

	// We know the guilds cache in the client is filled with all the guilds we're in at this point.
	// So we can tell the updated guilds cache about them.
	setGuildCommandsUpdated(Array.from(client.guilds.cache.keys()));

	// The bot might've been added to / removed from guilds while it was offline.
	// So we have to ensure guild configs exist and potentially remove left_timestamps from them for guilds we joined while offline
	// and to mark guild configs as left for those we left while offline.
	logger.info('Synchronising joined guilds with guild configurations.');
	try {
		const activatedGuildIds = syncGuilds(Array.from(client.guilds.cache.keys()), logger);

		// This is only really necessary for guilds that were rejoined, not those that were first joined,
		// since the latter won't have any need for webhooks or guarded commands yet.
		// But hopefully this number shouldn't be too high anyway and this should go fast enough.
		await Promise.allSettled(
			activatedGuildIds.map(async activatedGuildId => {
				try {
					return await ensureWebhookCorrectness(client, activatedGuildId);
				} catch (error) {
					logger.error(error, 'Error while trying to ensure webhook correctness for guild %s', activatedGuildId);
				}

				try {
					const guild = client.guilds.cache.get(activatedGuildId);
					if (guild) {
						await updateCommandsForSingleGuild(guild);
					}
				} catch (error) {
					logger.error(error, 'Error while trying to update commands for guild %s', activatedGuildId);
				}
			})
		);
	} catch (error) {
		logger.error(error, 'Could not synchronise guilds on startup.');
	}

	initMaintenanceJobs(client);

	// This will only be defined if the process has been started a certain way (e.g. via pm2).
	// We use it to tell pm2 that the application can be considered fully online.
	if (process.send) {
		process.send('ready');
	}

	logger.info('Bot is ready.');
}

export default readyEvent;
