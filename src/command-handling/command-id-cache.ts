import { Snowflake, Collection, ApplicationCommand } from 'discord.js';
import {
	loadGlobalCommandIds,
	loadGuildCommandIds,
	persistGlobalCommandIds,
	persistGuildCommandIds
} from '../storage/command-id-dao.js';

let globalCommands = new Map<string, string>();
let guildCommands = new Map<string, Map<string, string>>();

export function loadPersistedCommandIds() {
	globalCommands = loadGlobalCommandIds();
	guildCommands = loadGuildCommandIds();
}

export function cacheGuildCommandIds(
	guildId: Snowflake,
	applicationCommands: Collection<Snowflake, ApplicationCommand>
) {
	const commandIds = new Map<string, string>();
	applicationCommands.each(command => {
		commandIds.set(command.name, command.id);
	});
	guildCommands.set(guildId, commandIds);

	persistGuildCommandIds(guildId, commandIds);
}

export function cacheGlobalCommandIds(applicationCommands: Collection<Snowflake, ApplicationCommand>) {
	globalCommands = new Map<string, string>();
	applicationCommands.each(command => {
		globalCommands.set(command.name, command.id);
	});

	persistGlobalCommandIds(globalCommands);
}

function getCommandId(commandName: string, guildId: Snowflake) {
	const globalCommandId = globalCommands.get(commandName);
	if (globalCommandId) {
		return globalCommandId;
	}
	const guildCommandIds = guildCommands.get(guildId);
	if (guildCommandIds) {
		const guildCommandId = guildCommandIds.get(commandName);
		if (guildCommandId) {
			return guildCommandId;
		}
	}
	return null;
}

export function commandMention(slashCommand: string, guildId: Snowflake) {
	if (!slashCommand.startsWith('/')) {
		slashCommand = '/' + slashCommand;
	}
	const commandParts = slashCommand.split(' ');
	const rootCommandName = commandParts[0].substring(1);

	if (rootCommandName) {
		const commandId = getCommandId(rootCommandName, guildId);
		if (commandId) {
			// This command exists, so we can create a mention for it.
			return '<' + slashCommand + ':' + commandId + '>';
		}
	}

	// Fallback: just print command string as provided (possibly with a / in front if it was missing) wrapped in code syntax.
	return '`' + slashCommand + '`';
}
