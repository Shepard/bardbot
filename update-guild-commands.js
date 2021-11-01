export async function updateCommandsForAllGuilds(client) {
	console.log('Updating commands for all guilds.');

	// Map all guilds the client is currently in to a promise each that updates all commands for that guild.
	// Then wait for all those promises to be done.
	await Promise.allSettled(client.guilds.cache.map(async (guild) => {
		try {
			return await updateCommandsForSingleGuild(client, guild);
		} catch (e) {
			console.error(e);
		}
	}));

	console.log('Commands for all guilds updated.');
}

export async function updateCommandsForSingleGuild(client, guild) {
	const guildConfig = client.guildConfigs.find(gc => gc.id === guild.id);

	const guildCommands = [];
	client.commands.each(command => {
		// If the command has a check (a 'guard') then perform that first before adding that command's configuration.
		if (!command.guard || command.guard(client, guild, guildConfig)) {
			guildCommands.push(command.configuration);
		}
	});
	return guild.commands.set(guildCommands);
}