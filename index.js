import process from 'process';
import fsPromises from 'fs/promises';
import { Client, Collection, Intents } from 'discord.js';

async function initApp() {
	const { token, guilds } = JSON.parse(await fsPromises.readFile('./config.json'));

	const client = new Client({
		intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MEMBERS],
		presence: { activities: [{ name: 'Toss a coin to your witcher', type: 2 }] }
	});

	client.guildConfigs = guilds;

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
		process.exit(0);
	});
}

async function getJSFilesInDir(path) {
	return (await fsPromises.readdir(path)).filter(file => file.endsWith('.js'));
}

initApp();