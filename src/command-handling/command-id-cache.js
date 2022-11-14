const guildCommands = new Map();

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
		if (guildId && rootCommandName) {
			const commandId = getCommandId(rootCommandName, guildId);
			if (commandId) {
				// This command exists, so we can create a mention for it.
				return '<' + slashCommand + ':' + commandId + '>';
			}
		}
	}

	// Fallback: just print command string as provided (possibly with a / in front if it was missing) wrapped in code syntax.
	return '`' + slashCommand + '`';
}
