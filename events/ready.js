import process from 'process';
import { updateCommandsForAllGuilds } from '../command-handling/update-commands.js';
import { initMaintenanceJobs } from '../storage/maintenance-jobs.js';

const readyEvent = {
	name: 'ready',
	once: true,
	execute(client) {
		handleReady(client).catch(e => console.error(e));
	}
};

async function handleReady(client) {
	console.log(`Client is connected. Logged in as ${client.user.tag}.`);

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
