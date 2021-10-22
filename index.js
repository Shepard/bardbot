import fs from 'fs';
import { Client, Collection, Intents } from 'discord.js';
import deployGuildCommands from './deploy-guild-commands.js';

const { token, guilds } = JSON.parse(fs.readFileSync('./config.json'));

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

client.guildConfigs = guilds;

// Find all js files in /commands, import them and collect their exported commands on the client for later use.
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
client.commands = new Collection();
for (const file of commandFiles) {
	const command = (await import(`./commands/${file}`)).default;
	client.commands.set(command.data.name, command);
}

// Find all js files in /events, import them and register their exported event handlers on the client.
const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
	const event = (await import(`./events/${file}`)).default;
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args));
	} else {
		client.on(event.name, (...args) => event.execute(...args));
	}
}

client.login(token);

deployGuildCommands(client);