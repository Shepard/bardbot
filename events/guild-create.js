import { updateCommandsForSingleGuild, areGuildCommandsUpdated } from '../command-handling/update-commands.js';

const guildCreateEvent = {
	name: 'guildCreate',
	execute(guild) {
		handleGuildCreate(guild).catch(e => console.error(e));
	}
};

async function handleGuildCreate(guild) {
	if (!areGuildCommandsUpdated(guild.id)) {
		console.log(`Updating commands for guild ${guild.id} after receiving guild create event.`);
		await updateCommandsForSingleGuild(guild.client, guild);
	}
}

export default guildCreateEvent;
