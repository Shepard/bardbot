import fs from 'fs';
import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';

const { clientId, guildId, token } = JSON.parse(fs.readFileSync('./config.json'));

(async () => {
	// Find all js files in /commands, import them and deploy their exported commands as
	// globally available commands (i.e. on any server where the bot is joined).

	const commands = [];

	const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

	for (const file of commandFiles) {
		const command = (await import(`./commands/${file}`)).default;
		commands.push(command.data);
	}

	const rest = new REST({ version: '9' }).setToken(token);

	try {
		console.log('Started refreshing application (/) commands.');

		await rest.put(
			Routes.applicationCommands(clientId),
			{ body: commands },
		);

		console.log('Successfully reloaded application (/) commands.');
	} catch (error) {
		console.error(error);
	}
})();