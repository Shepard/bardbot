export default function deployGuildCommands(client) {
	client.on("ready", async () => {
		console.log('Deploying commands for guilds.');

		await Promise.allSettled(client.guilds.cache.map(guild => {
			const guildConfig = client.guildConfigs.find(gc => gc.id === guild.id);

			const guildCommands = [];
			client.commands.each(command => {
				if (!command.guard || command.guard(client, guild, guildConfig)) {
					guildCommands.push(command.data);
				}
			});
			return guild.commands.set(guildCommands);
		}));

		console.log('Commands for guilds deployed.');
	});
};