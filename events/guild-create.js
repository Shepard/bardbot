import { updateCommandsForSingleGuild, areGuildCommandsUpdated } from '../command-handling/update-commands.js';

const guildCreateEvent = {
	name: 'guildCreate',
	async execute(guild) {
		if (!areGuildCommandsUpdated(guild.id)) {
			console.log(`Updating commands for guild ${guild.id} after receiving guild create event.`);
			await updateCommandsForSingleGuild(guild.client, guild);
		}
	}
};

export default guildCreateEvent;