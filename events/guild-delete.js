import { setGuildCommandsNotUpdated } from '../command-handling/update-commands.js';

const guildDeleteEvent = {
	name: 'guildDelete',
	execute(guild) {
		handleGuildDelete(guild);
	}
};

function handleGuildDelete(guild) {
	if (guild.available) {
		// If the bot got removed from a guild (and not just because the guild temporarily became unavailable) then the commands in there are lost as well.
		// So we need to make sure they will be updated again when the bot gets invited to that guild again.
		setGuildCommandsNotUpdated(guild.id);
	}

	// TODO Could register a time in the guild_config (create if not exists?)
	//  and then add a clean-up task to remove guild config (including RP channels) after some time.
}

export default guildDeleteEvent;
