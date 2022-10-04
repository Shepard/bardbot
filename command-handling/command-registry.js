import { Collection } from 'discord.js';
import { getJSFilesInDir } from '../util/helpers.js';
import { addCommandTranslations } from './command-translations.js';

export const commands = new Collection();

const guildCommands = new Map();

export async function loadCommands() {
	// Find all js files in /commands, import them and collect their exported commands on the client for later use.
	const commandFiles = await getJSFilesInDir('./commands');
	for (const file of commandFiles) {
		const command = (await import(`../commands/${file}`)).default;
		addCommandTranslations(command);
		commands.set(command.configuration.name, command);
	}
}

export function cacheCommandIds(guildId, applicationCommands) {
	const commandIds = new Map();
	applicationCommands.each(command => {
		commandIds.set(command.name, command.id);
	});
	guildCommands.set(guildId, commandIds);
}

function getCommandId(commandName, guildId) {
	const commandIds = guildCommands.get(guildId);
	if (commandIds) {
		const commandId = commandIds.get(commandName);
		if (commandId) {
			return commandId;
		}
	}
	return null;
}

export function commandMention(slashCommand, guildId) {
	if (!slashCommand.startsWith('/')) {
		slashCommand = '/' + slashCommand;
	}
	const commandParts = slashCommand.split(' ');
	const rootCommandName = commandParts[0].substring(1);

	if (rootCommandName) {
		// Ensure that the command actually exists.
		// Ideally we'd also check for the existence of sub command groups and sub commands but it should be good enough for now.
		const command = commands.get(rootCommandName);
		if (command) {
			if (guildId && rootCommandName) {
				const commandId = getCommandId(rootCommandName, guildId);
				if (commandId) {
					// This command exists, so we can create a mention for it.
					return '<' + slashCommand + ':' + commandId + '>';
				}
			}
		}
	}

	// Fallback: just print command string as provided (possibly with a / in front if it was missing) wrapped in code syntax.
	return '`' + slashCommand + '`';
}
