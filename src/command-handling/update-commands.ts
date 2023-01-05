import { Client, Guild, Snowflake } from 'discord.js';
import { getGuildConfig } from '../storage/guild-config-dao.js';
import { commands } from './command-registry.js';
import { cacheGuildCommandIds, cacheGlobalCommandIds } from './command-id-cache.js';
import { isGuardedCommand } from './command-module-types.js';
import logger from '../util/logger.js';

const updatedGuildsCache = new Set<string>();

export async function updateGlobalCommands(client: Client) {
	try {
		logger.info('Updating global commands.');

		const globalCommandConfigurations = commands
			.filter(command => !isGuardedCommand(command))
			.map(command => command.configuration);
		const remoteCommands = await client.application.commands.set(globalCommandConfigurations);
		cacheGlobalCommandIds(remoteCommands);

		logger.info('Global commands updated.');
	} catch (e) {
		logger.error('Error while trying to update global commands:', e);
	}
}

export async function updateCommandsForAllGuilds(client: Client) {
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

export async function updateCommandsForSingleGuild(client: Client, guild: Guild) {
	try {
		const guildConfig = getGuildConfig(guild.id, logger);

		const guildCommandConfigurations = commands
			.filter(command => isGuardedCommand(command) && command.guard(client, guild, guildConfig, logger))
			.map(command => command.configuration);
		const remoteCommands = await guild.commands.set(guildCommandConfigurations);
		cacheGuildCommandIds(guild.id, remoteCommands);

		updatedGuildsCache.add(guild.id);
	} catch (error) {
		setGuildCommandsNotUpdated(guild.id);
		throw error;
	}
}

export function areGuildCommandsUpdated(guildId: Snowflake) {
	return updatedGuildsCache.has(guildId);
}

export function setGuildCommandsNotUpdated(guildId: Snowflake) {
	updatedGuildsCache.delete(guildId);
}
