import { Statement } from 'better-sqlite3';
import { Logger } from 'pino';
import {
	GuildConfiguration,
	GuildConfigurationPatch,
	RolePlayChannelsData,
	SupportedLanguage
} from './record-types.js';
import db, { registerDbInitialisedListener } from './database.js';
import logger from '../util/logger.js';
import { differenceSet } from '../util/helpers.js';

let getGuildConfigStatement: Statement = null;
let getActiveGuildIdsStatement: Statement = null;
let ensureGuildConfigExistsStatement: Statement = null;
let addOrReactivateGuildConfigStatement: Statement = null;
let setBookmarksChannelStatement: Statement = null;
let setQuotesChannelStatement: Statement = null;
let setLanguageStatement: Statement = null;
let setConfigurationValuesStatement: Statement = null;
let setLeftTimestampStatement: Statement = null;
let removeLeftTimestampStatement: Statement = null;
let deleteObsoleteGuildDataStatement: Statement = null;

let getRolePlayChannelsDataStatement: Statement = null;
let addRolePlayChannelStatement: Statement = null;
let removeRolePlayChannelStatement: Statement = null;
let removeAllRolePlayChannelsStatement: Statement = null;
let getWebhookIdForRolePlayChannelStatement: Statement = null;
let setWebhookIdForRolePlayChannelStatement: Statement = null;

// Find guilds that have been left more than a day ago.
const obsoleteGuildsFromClause =
	'FROM guild_config AS g WHERE g.left_timestamp IS NOT NULL AND :secondsSinceEpoch - g.left_timestamp > 60 * 60 * 24';
export const obsoleteGuildsSelect = 'SELECT g.id ' + obsoleteGuildsFromClause;

registerDbInitialisedListener(() => {
	getGuildConfigStatement = db.prepare(
		'SELECT bookmarks_channel_id, quotes_channel_id, language FROM guild_config WHERE id = :id'
	);
	getActiveGuildIdsStatement = db.prepare('SELECT id FROM guild_config WHERE left_timestamp IS NULL').pluck();
	ensureGuildConfigExistsStatement = db.prepare('INSERT INTO guild_config(id) VALUES(:id) ON CONFLICT(id) DO NOTHING');
	addOrReactivateGuildConfigStatement = db.prepare(
		'INSERT INTO guild_config(id) VALUES(:id) ON CONFLICT(id) DO UPDATE SET left_timestamp = NULL'
	);
	setBookmarksChannelStatement = db.prepare(
		'INSERT INTO guild_config(id, bookmarks_channel_id)' +
			' VALUES(:id, :bookmarksChannelId)' +
			' ON CONFLICT(id) DO UPDATE SET bookmarks_channel_id = :bookmarksChannelId'
	);
	setQuotesChannelStatement = db.prepare(
		'INSERT INTO guild_config(id, quotes_channel_id)' +
			' VALUES(:id, :quotesChannelId)' +
			' ON CONFLICT(id) DO UPDATE SET quotes_channel_id = :quotesChannelId'
	);
	setLanguageStatement = db.prepare(
		'INSERT INTO guild_config(id, language)' +
			' VALUES(:id, :language)' +
			' ON CONFLICT(id) DO UPDATE SET language = :language'
	);
	setConfigurationValuesStatement = db.prepare(
		'INSERT INTO guild_config(id, bookmarks_channel_id, quotes_channel_id, language)' +
			' VALUES(:id, :bookmarksChannelId, :quotesChannelId, :language)' +
			' ON CONFLICT(id) DO UPDATE SET bookmarks_channel_id = :bookmarksChannelId, quotes_channel_id = :quotesChannelId, language = :language'
	);
	setLeftTimestampStatement = db.prepare('UPDATE guild_config SET left_timestamp = unixepoch() WHERE id = :id');
	removeLeftTimestampStatement = db.prepare(
		'UPDATE guild_config SET left_timestamp = NULL WHERE id = :id AND left_timestamp IS NOT NULL'
	);
	deleteObsoleteGuildDataStatement = db.prepare('DELETE ' + obsoleteGuildsFromClause);

	getRolePlayChannelsDataStatement = db.prepare(
		'SELECT role_play_channel_id, webhook_id FROM guild_role_play_channel WHERE guild_id = :guildId'
	);
	addRolePlayChannelStatement = db.prepare(
		'INSERT OR IGNORE INTO guild_role_play_channel(guild_id, role_play_channel_id, webhook_id)' +
			' VALUES(:guildId, :rolePlayChannelId, :webhookId)'
	);
	removeRolePlayChannelStatement = db.prepare(
		'DELETE FROM guild_role_play_channel WHERE guild_id = :guildId AND role_play_channel_id = :rolePlayChannelId'
	);
	removeAllRolePlayChannelsStatement = db.prepare('DELETE FROM guild_role_play_channel WHERE guild_id = :guildId');
	getWebhookIdForRolePlayChannelStatement = db.prepare(
		'SELECT webhook_id FROM guild_role_play_channel WHERE guild_id = :guildId AND role_play_channel_id = :rolePlayChannelId'
	);
	setWebhookIdForRolePlayChannelStatement = db.prepare(
		'UPDATE guild_role_play_channel SET webhook_id = :webhookId WHERE guild_id = :guildId AND role_play_channel_id = :rolePlayChannelId'
	);
});

/**
 * Tries to retrieve configuration for a guild from the database.
 * If no information is present in the database or if an error occurred while querying the database,
 * this is handled and a minimal configuration object is returned.
 */
export function getGuildConfig(guildId: string, logger: Logger): GuildConfiguration {
	try {
		const config = getGuildConfigStatement.get({ id: guildId });
		if (config) {
			const rolePlayChannelIds = getRolePlayChannelIds(guildId);
			return {
				id: guildId,
				bookmarksChannelId: config.bookmarks_channel_id,
				quotesChannelId: config.quotes_channel_id,
				language: config.language,
				rolePlayChannelIds
			};
		}
		return { id: guildId };
	} catch (e) {
		logger.error(e, 'Error while trying to fetch config for guild %s from database', guildId);
		return { id: guildId };
	}
}

/**
 * Fetches the ids of all guilds for which we have configuration data stored in the database and that the bot has not left.
 * @returns An array of all the ids. If there are no ids or if an error occurred while querying the database,
 * this is handled and an empty array is returned.
 */
export function getActiveGuildIds(): string[] {
	try {
		return getActiveGuildIdsStatement.all();
	} catch (e) {
		logger.error(e);
		return [];
	}
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function ensureGuildConfigurationExists(guildId: string) {
	const info = ensureGuildConfigExistsStatement.run({ id: guildId });
	return info.changes > 0;
}

/**
 * Synchronises the guilds the bot is currently in with the guild configurations stored in the database.
 * Will add / reactivate new ones and deactivate superfluous ones (by setting left_timestamp in their records).
 * @param activeGuildIds An array of ids of guilds which the bot is currently in.
 * @returns An array of those ids from the input which were not previously stored as active guild configurations in the database but are now.
 * @throws Caller has to handle potential database errors.
 */
export function syncGuilds(activeGuildIds: string[], logger: Logger) {
	const existingActiveGuildIds = getActiveGuildIds();

	// Guilds which the bot is currently in but where we either don't have a guild_config stored or it has a left_timestamp set
	// will be added / reactivated.
	const unactivatedGuildIds = differenceSet(activeGuildIds, existingActiveGuildIds);

	// Guilds for which we have a guild_config stored but which we are not in anymore will get a left_timestamp set
	// so that their data will be cleaned up by a maintenance job at a later time.
	const superfluousGuildIds = differenceSet(existingActiveGuildIds, activeGuildIds);

	// Mainly using a transaction here in the hope that this might make these statements run faster
	// (because no individual transactions will be used per call).
	db.transaction(() => {
		for (const guildId of unactivatedGuildIds) {
			addOrReactivateGuildConfigStatement.run({ id: guildId });
		}
		for (const guildId of superfluousGuildIds) {
			setLeftTimestamp(guildId);
		}
	})();

	if (unactivatedGuildIds.size > 0 || superfluousGuildIds.size > 0) {
		logger.info(
			'Sync added/reactivated %d guild configurations and marked %d guild configurations for later removal.',
			unactivatedGuildIds.size,
			superfluousGuildIds.size
		);
	}

	// These have now been added / reactivated. Return them so the caller can perform additional actions on them.
	return Array.from(unactivatedGuildIds);
}

/**
 * Adds a new guild config with the values provided in the patch object
 * or changes properties of an existing guild config in the database if a record already exists for the id property in the provided patch.
 * All existing values will be overwritten with the ones form the patch.
 *
 * @param patchedGuildConfig An object containing all the properties a guild config can have in the database.
 * The values of those properties will be used to override any existing guild config or create a new one.
 * In particular: "id" will be used to identify the guild config to override.
 * The other properties are bookmarksChannelId, quotesChannelId and language.
 * "rolePlayChannels", while provided in getGuildConfig, is not used as a property here.
 * @throws Caller has to handle potential database errors.
 */
export function setConfigurationValues(patchedGuildConfig: GuildConfigurationPatch) {
	setConfigurationValuesStatement.run(patchedGuildConfig);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export const clearConfigurationValues = db.transaction((guildId: string) => {
	setConfigurationValuesStatement.run({
		id: guildId,
		bookmarksChannelId: null,
		quotesChannelId: null,
		language: null
	});
	removeAllRolePlayChannels(guildId);
});

/**
 * @throws Caller has to handle potential database errors.
 */
export function setBookmarksChannel(guildId: string, bookmarksChannelId: string | null) {
	setBookmarksChannelStatement.run({ id: guildId, bookmarksChannelId });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function setQuotesChannel(guildId: string, quotesChannelId: string | null) {
	setQuotesChannelStatement.run({ id: guildId, quotesChannelId });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function setLanguage(guildId: string, language: SupportedLanguage | null) {
	setLanguageStatement.run({ id: guildId, language });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function setLeftTimestamp(guildId: string) {
	setLeftTimestampStatement.run({ id: guildId });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function removeLeftTimestamp(guildId: string) {
	const info = removeLeftTimestampStatement.run({ id: guildId });
	return info.changes > 0;
}

/**
 * Deletes all data (configuration, message metadata, alts, stories, ...) stored for guilds
 * that have been left over a day ago and returns the number of deleted entries.
 *
 * @throws Caller has to handle potential database errors.
 */
export function deleteObsoleteGuildData() {
	const secondsSinceEpoch = Math.floor(Date.now() / 1000);
	const info = deleteObsoleteGuildDataStatement.run({ secondsSinceEpoch });
	return info.changes;
}

/**
 * @throws Caller has to handle potential database errors.
 */
function getRolePlayChannelIds(guildId: string): string[] {
	return getRolePlayChannelsDataStatement.all({ guildId }).map(row => row.role_play_channel_id);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function addRolePlayChannel(guildId: string, rolePlayChannelId: string, webhookId: string) {
	ensureGuildConfigurationExists(guildId);

	addRolePlayChannelStatement.run({ guildId, rolePlayChannelId, webhookId });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function removeRolePlayChannel(guildId: string, rolePlayChannelId: string) {
	removeRolePlayChannelStatement.run({ guildId, rolePlayChannelId });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function removeAllRolePlayChannels(guildId: string) {
	removeAllRolePlayChannelsStatement.run({ guildId });
}

/**
 * Returns the webhook id saved for a role-play channel with the provided id in the guild with the provided id.
 * If this channel is not configured as a role-play channel in this server, null is returned.
 * Note that the webhook might be invalid.
 * @throws Caller has to handle potential database errors.
 */
export function getWebhookIdForRolePlayChannel(guildId: string, rolePlayChannelId: string): string | null {
	const result = getWebhookIdForRolePlayChannelStatement.get({ guildId, rolePlayChannelId });
	return result?.webhook_id ?? null;
}

/**
 * Return an array of the webhook ids saved for each role-play channel in the guild with the provided id.
 * If there are no role-play channels configured for this guild, an empty array is returned.
 * Note that the webhooks might be invalid.
 * @throws Caller has to handle potential database errors.
 */
export function getWebhookIdsForRolePlayChannels(guildId: string): string[] {
	return getRolePlayChannelsDataStatement.all({ guildId }).map(row => row.webhook_id);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function getRolePlayChannelsData(guildId: string): RolePlayChannelsData[] {
	return getRolePlayChannelsDataStatement.all({ guildId }).map(row => ({
		rolePlayChannelId: row.role_play_channel_id,
		webhookId: row.webhook_id
	}));
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function setWebhookIdForRolePlayChannel(guildId: string, rolePlayChannelId: string, webhookId: string) {
	setWebhookIdForRolePlayChannelStatement.run({ guildId, rolePlayChannelId, webhookId });
}
