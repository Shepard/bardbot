import process from 'process';
import { updateCommandsForAllGuilds } from '../command-handling/update-commands.js';
import { initMaintenanceJobs } from '../storage/maintenance-jobs.js';
import { syncGuilds } from '../storage/guild-config-dao.js';
import logger from '../util/logger.js';

const readyEvent = {
	name: 'ready',
	once: true,
	execute(client) {
		handleReady(client).catch(e => logger.error(e));
	}
};

async function handleReady(client) {
	logger.info('Client is connected. Logged in as %s serving %d guilds.', client.user.tag, client.guilds.cache.size);

	// The bot might've been added to / removed from guilds while it was offline.
	// So we have to ensure guild configs exist and potentially remove left_timestamps from them for guilds we joined while offline
	// and to mark guild configs as left for those we left while offline.
	logger.info('Synchronising joined guilds with guild configurations.');
	try {
		syncGuilds(Array.from(client.guilds.cache.keys()), logger);
		// TODO later: and update commands for activatedGuilds returned by this call when we don't do that for all anymore.
	} catch (error) {
		logger.error(error, 'Could not synchronise guilds on startup.');
	}

	// Only update the commands when the client is ready so we know the guilds cache in the client is filled.
	await updateCommandsForAllGuilds(client);

	initMaintenanceJobs(client);

	// This will only be defined if the process has been started a certain way (e.g. via pm2).
	// We use it to tell pm2 that the application can be considered fully online.
	if (process.send) {
		process.send('ready');
	}
}

export default readyEvent;
