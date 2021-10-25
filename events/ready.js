import process from 'process';
import { updateCommandsForAllGuilds } from '../update-guild-commands.js';

const readyEvent = {
	name: 'ready',
	once: true,
	async execute(client) {
		console.log(`Client is connected. Logged in as ${client.user.tag}.`);

		// Wait for the client to be ready so we know the guilds cache in the client is filled.
		await updateCommandsForAllGuilds(client);

		// This will only be defined if the process has been started a certain way (e.g. via pm2).
		// We use it to tell pm2 that the application can be considered fully online.
		if (process.send) {
			process.send('ready');
		}
	}
};

export default readyEvent;