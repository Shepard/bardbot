import fs from 'fs';
import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';

const { clientId, guilds, token } = JSON.parse(fs.readFileSync('./config.json'));

(async () => {
	// Find all js files in /commands, import them and deploy their exported commands as
	// available commands on any server ("guild") found in the configuration file.

	const commands = [];

	const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

	for (const file of commandFiles) {
		const command = (await import(`./commands/${file}`)).default;
		commands.push(command.data);
	}

	const rest = new REST({ version: '9' }).setToken(token);

	try {
		console.log('Started refreshing application (/) commands.');

		guilds.forEach(async (guild) => {
			// TODO check if the bot is in that guild.
			await rest.put(
				Routes.applicationGuildCommands(clientId, guild.id),
				{ body: commands },
			);
		});

		console.log('Successfully reloaded application (/) commands.');
	} catch (error) {
		console.error(error);
	}
})();