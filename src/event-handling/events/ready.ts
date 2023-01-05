import { Client } from 'discord.js';
import process from 'process';
import { ClientEventHandler } from '../event-handler-types.js';
import { updateCommandsForAllGuilds, updateGlobalCommands } from '../../command-handling/update-commands.js';
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

	// The bot might've been added to / removed from guilds while it was offline.
	// So we have to ensure guild configs exist and potentially remove left_timestamps from them for guilds we joined while offline
	// and to mark guild configs as left for those we left while offline.
	logger.info('Synchronising joined guilds with guild configurations.');
	try {
		const activatedGuildIds = syncGuilds(Array.from(client.guilds.cache.keys()), logger);

		// This is only really necessary for guilds that were rejoined, not those that were first joined, since the latter won't have any need for webhooks yet.
		// But hopefully this number shouldn't be too high anyway and this should go fast enough.
		await Promise.allSettled(
			activatedGuildIds.map(activatedGuildId => {
				return ensureWebhookCorrectness(client, activatedGuildId).catch(e => {
					logger.error(e, 'Error while trying to ensure webhook correctness for guild %s', activatedGuildId);
				});
			})
		);

		// TODO: and update commands for activatedGuildIds returned by this call when we don't do that for all anymore.
	} catch (error) {
		logger.error(error, 'Could not synchronise guilds on startup.');
	}

	// TODO only when requested. otherwise: loadPersistedCommandIds();
	await updateGlobalCommands(client);
	// Only update the guild commands when the client is ready so we know the guilds cache in the client is filled.
	await updateCommandsForAllGuilds(client);

	initMaintenanceJobs(client);

	// This will only be defined if the process has been started a certain way (e.g. via pm2).
	// We use it to tell pm2 that the application can be considered fully online.
	if (process.send) {
		process.send('ready');
	}
}

export default readyEvent;
