import { Constants } from 'discord.js';
import { getGuildConfig } from '../storage/guild-config-dao.js';

const updatedGuildsCache = new Set();

export async function updateCommandsForAllGuilds(client) {
	console.log('Updating commands for all guilds.');

	// Map all guilds the client is currently in to a promise each that updates all commands for that guild.
	// Then wait for all those promises to be done.
	await Promise.allSettled(
		client.guilds.cache.map(guild => {
			return updateCommandsForSingleGuild(client, guild).catch(e => {
				console.error(`Error while trying to update commands for guild ${guild.id}:`, e);
			});
		})
	);

	console.log('Commands for all guilds updated.');
}

export async function updateCommandsForSingleGuild(client, guild) {
	const guildConfig = getGuildConfig(guild.id);

	const guildCommands = [];
	client.commands.each(command => {
		// If the command has a check (a 'guard') then perform that first before adding that command's configuration.
		if (!command.guard || command.guard(client, guild, guildConfig)) {
			const commandConfiguration = {
				...command.configuration
			};
			// If the command declares any permissions (which we set separately below)
			// we need to turn the default permissions in the command configuration off.
			if (command.permissions) {
				commandConfiguration.default_permission = false;
			}
			guildCommands.push(commandConfiguration);
		}
	});

	const remoteCommands = await guild.commands.set(guildCommands);

	const fullPermissions = remoteCommands
		.map(remoteCommand => {
			const matchingLocalCommand = client.commands.find(
				localCommand => localCommand.configuration.name === remoteCommand.name
			);
			if (matchingLocalCommand?.permissions) {
				const roles = getMatchingRoles(guild, matchingLocalCommand.permissions);
				return {
					id: remoteCommand.id,
					permissions: roles.map(role => ({
						id: role.id,
						type: Constants.ApplicationCommandPermissionTypes.ROLE,
						permission: true
					}))
				};
			}
			return null;
		})
		.filter(commandPermissions => commandPermissions !== null);

	await guild.commands.permissions.set({ fullPermissions });

	updatedGuildsCache.add(guild.id);
}

function getMatchingRoles(guild, permissions) {
	return guild.roles.cache.filter(role => role.permissions.has(permissions) && !role.managed);
}

export function areGuildCommandsUpdated(guildId) {
	return updatedGuildsCache.has(guildId);
}
