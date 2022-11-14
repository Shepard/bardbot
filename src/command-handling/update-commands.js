import { getGuildConfig } from '../storage/guild-config-dao.js';
import { commands } from './command-registry.js';
import { cacheCommandIds } from './command-id-cache.js';
import logger from '../util/logger.js';

const updatedGuildsCache = new Set();

export async function updateCommandsForAllGuilds(client) {
	logger.info('Updating commands for all guilds.');

	// Map all guilds the client is currently in to a promise each that updates all commands for that guild.
	// Then wait for all those promises to be done.
	await Promise.allSettled(
		client.guilds.cache.map(guild => {
			return updateCommandsForSingleGuild(client, guild).catch(e => {
				logger.error(e, 'Error while trying to update commands for guild %s', guild.id);
			});
		})
	);

	logger.info('Commands for all guilds updated.');
}

export async function updateCommandsForSingleGuild(client, guild) {
	try {
		const guildConfig = getGuildConfig(guild.id, logger);

		const guildCommands = [];
		commands.each(command => {
			// If the command has a check (a 'guard') then perform that first before adding that command's configuration.
			if (!command.guard || command.guard(client, guild, guildConfig, logger)) {
				guildCommands.push(command.configuration);
			}
		});

		const remoteCommands = await guild.commands.set(guildCommands);
		cacheCommandIds(guild.id, remoteCommands);

		updatedGuildsCache.add(guild.id);
	} catch (error) {
		setGuildCommandsNotUpdated(guild.id);
		throw error;
	}
}

export function areGuildCommandsUpdated(guildId) {
	return updatedGuildsCache.has(guildId);
}

export function setGuildCommandsNotUpdated(guildId) {
	updatedGuildsCache.delete(guildId);
}
