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

	// TODO Register a time in the guild_config (create if not exists?)
	//  and then add a clean-up task to remove guild config (including RP channels), alts and message metadata after some time.
	//  Aligns with Discord Developer Policy: https://discord.com/developers/docs/policy
	//  "You may not use the APIs in any way to: [...] retain data any longer than necessary for the operation of your application"
	//  The time needs to be short enough to be considered complying with this policy
	//  and long enough that it won't make the bot useless in cases where it only gets removed temporarily (e.g. when trying to add permissions).
}

export default guildDeleteEvent;
