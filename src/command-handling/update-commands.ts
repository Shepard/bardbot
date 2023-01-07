import {
	Client,
	Guild,
	Snowflake,
	REST,
	Routes,
	Collection,
	ApplicationCommandData,
	SlashCommandBuilder,
	APIApplicationCommand
} from 'discord.js';
import { getGuildConfig, getActiveGuildIds } from '../storage/guild-config-dao.js';
import { commands } from './command-registry.js';
import { cacheGuildCommandIds, cacheGlobalCommandIds } from './command-id-cache.js';
import { isGuardedCommand } from './command-module-types.js';
import logger from '../util/logger.js';
import { transformCommandConfigurations } from './command-transform.js';

const updatedGuildsCache = new Set<string>();

export async function updateGlobalCommands(client: Client) {
	await updateGlobalCommandsWithUpdater(async globalCommandConfigurations => {
		const remoteCommands = await client.application.commands.set(globalCommandConfigurations);
		return remoteCommands.mapValues(command => command.name);
	});
}

export async function updateGlobalCommandsWithoutClient(token: string, clientId: string) {
	await updateGlobalCommandsWithUpdater(async globalCommandConfigurations => {
		const rest = new REST({ version: '10' }).setToken(token);
		const data = (await rest.put(Routes.applicationCommands(clientId), {
			body: transformCommandConfigurations(globalCommandConfigurations)
		})) as APIApplicationCommand[];
		// Put the received command data in a collection.
		return data.reduce((coll, command) => coll.set(command.id, command.name), new Collection<string, string>());
	});
}

async function updateGlobalCommandsWithUpdater(
	updater: (commandConfigurations: ApplicationCommandData[]) => Promise<Collection<string, string>>
) {
	try {
		logger.info('Updating global commands.');

		const globalCommandConfigurations = commands
			.filter(command => !isGuardedCommand(command))
			.map(command => command.configuration);
		new SlashCommandBuilder();

		const remoteCommands = await updater(globalCommandConfigurations);

		cacheGlobalCommandIds(remoteCommands);

		logger.info('Global commands updated.');
	} catch (error) {
		logger.error(error, 'Error while trying to update global commands');
	}
}

export async function updateCommandsForAllGuilds(client: Client) {
	logger.info('Updating commands for all guilds.');

	// Map all guilds the client is currently in to a promise each that updates all commands for that guild.
	// Then wait for all those promises to be done.
	await Promise.allSettled(
		client.guilds.cache.map(guild => {
			return updateCommandsForSingleGuild(guild).catch(error => {
				logger.error(error, 'Error while trying to update commands for guild %s', guild.id);
			});
		})
	);

	logger.info('Commands for all guilds updated.');
}

export async function updateCommandsForAllGuildsWithoutClient(token: string, clientId: string) {
	try {
		logger.info('Updating commands for all guilds.');

		const rest = new REST({ version: '10' }).setToken(token);

		const guildIds = getActiveGuildIds();
		await Promise.allSettled(
			guildIds.map(guildId => {
				return updateCommandsForSingleGuildWithUpdater(guildId, async guildCommandConfigurations => {
					const data = (await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
						body: transformCommandConfigurations(guildCommandConfigurations)
					})) as APIApplicationCommand[];
					// Put the received command data in a collection.
					return data.reduce((coll, command) => coll.set(command.id, command.name), new Collection<string, string>());
				}).catch(error => {
					logger.error(error, 'Error while trying to update commands for guild %s', guildId);
				});
			})
		);

		logger.info('Commands for all guilds updated.');
	} catch (error) {
		logger.error(error, 'Error while trying to update commands for all guilds');
	}
}

export async function updateCommandsForSingleGuild(guild: Guild) {
	await updateCommandsForSingleGuildWithUpdater(guild.id, async guildCommandConfigurations => {
		const remoteCommands = await guild.commands.set(guildCommandConfigurations);
		return remoteCommands.mapValues(command => command.name);
	});
}

async function updateCommandsForSingleGuildWithUpdater(
	guildId: string,
	updater: (commandConfigurations: ApplicationCommandData[]) => Promise<Collection<string, string>>
) {
	try {
		const guildConfig = getGuildConfig(guildId, logger);

		const guildCommandConfigurations = commands
			.filter(command => isGuardedCommand(command) && command.guard(guildConfig, logger))
			.map(command => command.configuration);

		const remoteCommands = await updater(guildCommandConfigurations);

		cacheGuildCommandIds(guildId, remoteCommands);

		updatedGuildsCache.add(guildId);
	} catch (error) {
		setGuildCommandsNotUpdated(guildId);
		throw error;
	}
}

export function areGuildCommandsUpdated(guildId: Snowflake) {
	return updatedGuildsCache.has(guildId);
}

export function setGuildCommandsNotUpdated(guildId: Snowflake) {
	updatedGuildsCache.delete(guildId);
}

export function setGuildCommandsUpdated(guildIds: Snowflake[]) {
	guildIds.forEach(guildId => updatedGuildsCache.add(guildId));
}
