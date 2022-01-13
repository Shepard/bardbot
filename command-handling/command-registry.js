import { Collection } from 'discord.js';
import { getJSFilesInDir } from '../util/helpers.js';

export const commands = new Collection();

export async function loadCommands() {
	// Find all js files in /commands, import them and collect their exported commands on the client for later use.
	const commandFiles = await getJSFilesInDir('./commands');
	for (const file of commandFiles) {
		const command = (await import(`../commands/${file}`)).default;
		commands.set(command.configuration.name, command);
	}
}