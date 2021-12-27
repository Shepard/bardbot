import process from 'process';
import fsPromises from 'fs/promises';
import { Client, Collection, Intents } from 'discord.js';
import schedule from 'node-schedule';
import { initDatabase, closeDatabase } from './storage/database.js';
import { initMaintenanceJobs } from './storage/maintenance-jobs.js';

async function initApp() {
	const { token } = JSON.parse(await fsPromises.readFile('./config.json'));

	await initDatabase();

	initMaintenanceJobs();

	const client = new Client({
		intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MEMBERS, Intents.FLAGS.GUILD_MESSAGES],
		presence: { activities: [{ name: 'Toss a coin to your witcher', type: 2 }] }
	});

	// Find all js files in /commands, import them and collect their exported commands on the client for later use.
	const commandFiles = await getJSFilesInDir('./commands');
	client.commands = new Collection();
	for (const file of commandFiles) {
		const command = (await import(`./commands/${file}`)).default;
		client.commands.set(command.configuration.name, command);
	}

	// Find all js files in /events, import them and register their exported event handlers on the client.
	const eventFiles = await getJSFilesInDir('./events');
	for (const file of eventFiles) {
		const event = (await import(`./events/${file}`)).default;
		if (event.once) {
			client.once(event.name, (...args) => event.execute(...args));
		} else {
			client.on(event.name, (...args) => event.execute(...args));
		}
	}

	await client.login(token);

	// Gracefully shut down when process is requested to terminate.
	process.on('SIGINT', () => {
		client.destroy();
		closeDatabase();
		schedule.gracefulShutdown().then(() => process.exit(0));
	});
}

async function getJSFilesInDir(path) {
	return (await fsPromises.readdir(path)).filter(file => file.endsWith('.js'));
}

initApp().catch(e => console.error(e));
