import process from 'process';
import { Client, GatewayIntentBits } from 'discord.js';
import schedule from 'node-schedule';
import { initDatabase, closeDatabase } from './storage/database.js';
import { getJSFilesInDir } from './util/helpers.js';
import { loadCommands } from './command-handling/command-registry.js';
import { initI18n } from './util/i18n.js';
import logger from './util/logger.js';
import config from './util/config.js';

process.on('unhandledRejection', err => {
	logger.error(err, "There is an unhandled promise rejection. Forgot an 'await'?");
	process.exit(1);
});

try {
	await initI18n();
	await initDatabase();
	await loadCommands();

	const client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
		presence: { activities: [{ name: 'your stories', type: 0 }] }
	});

	// Find all js files in /events, import them and register their exported event handlers on the client.
	const eventFiles = await getJSFilesInDir('./src/events');
	for (const file of eventFiles) {
		const event = (await import(`./events/${file}`)).default;
		if (event.once) {
			client.once(event.name, (...args) => event.execute(...args));
		} else {
			client.on(event.name, (...args) => event.execute(...args));
		}
	}

	await client.login(config.token);

	// Gracefully shut down when process is requested to terminate.
	process.on('SIGINT', () => {
		client.destroy();
		closeDatabase();
		schedule.gracefulShutdown().then(() => process.exit(0));
	});
} catch (error) {
	logger.error(error);
}
