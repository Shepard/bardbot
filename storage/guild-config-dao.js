import db, { registerDbInitialisedListener } from './database.js';
import logger from '../util/logger.js';

let getGuildConfigStatement = null;
let getGuildIdsForGuildsWithConfigurationStatement = null;
let setBookmarksChannelStatement = null;
let setQuotesChannelStatement = null;
let setLanguageStatement = null;
let setConfigurationValuesStatement = null;
let removeGuildConfigStatement = null;

let getRolePlayChannelsDataStatement = null;
let addRolePlayChannelStatement = null;
let removeRolePlayChannelStatement = null;
let removeAllRolePlayChannelsStatement = null;
let getWebhookIdForRolePlayChannelStatement = null;
let setWebhookIdForRolePlayChannelStatement = null;

registerDbInitialisedListener(() => {
	getGuildConfigStatement = db.prepare(
		'SELECT bookmarks_channel_id, quotes_channel_id, language FROM guild_config WHERE id = :id'
	);
	getGuildIdsForGuildsWithConfigurationStatement = db.prepare(
		'SELECT id FROM guild_config UNION SELECT guild_id as id FROM guild_role_play_channel'
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
	removeGuildConfigStatement = db.prepare('DELETE FROM guild_config WHERE id = :id');

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
export function getGuildConfig(guildId, logger) {
	try {
		const config = getGuildConfigStatement.get({ id: guildId });
		if (config) {
			const rolePlayChannels = getRolePlayChannelIds(guildId);
			return {
				id: guildId,
				bookmarksChannel: config.bookmarks_channel_id,
				quotesChannel: config.quotes_channel_id,
				language: config.language,
				rolePlayChannels
			};
		}
		return { id: guildId };
	} catch (e) {
		logger.error(e);
		return { id: guildId };
	}
}

/**
 * Fetches the ids of all guilds for which we have configuration data stored in the database.
 * @returns An array of all the ids. If there are no ids or if an error occurred while querying the database,
 * this is handled and an empty array is returned.
 */
export function getGuildIdsForGuildsWithConfiguration() {
	try {
		return getGuildIdsForGuildsWithConfigurationStatement.all().map(row => row.id);
	} catch (e) {
		logger.error(e);
		return [];
	}
}

/**
 * Adds a new guild config with the values provided in the patch object
 * or changes properties of an existing guild config in the database if a record already exists for the id property in the provided patch.
 * All existing values will be overwritten with the ones form the patch.
 *
 * @param {*} patchedGuildConfig An object containing all the properties a guild config can have in the database.
 * The values of those properties will be used to override any existing guild config or create a new one.
 * In particular: "id" will be used to identify the guild config to override.
 * The other properties are bookmarksChannelId, quotesChannelId and language.
 * "rolePlayChannels", while provided in getGuildConfig, is not used as a property here.
 * @throws Caller has to handle potential database errors.
 */
export function setConfigurationValues(patchedGuildConfig) {
	setConfigurationValuesStatement.run(patchedGuildConfig);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export const clearConfigurationValues = db.transaction(guildId => {
	removeGuildConfigStatement.run({ id: guildId });
	removeAllRolePlayChannels(guildId);
});

/**
 * @throws Caller has to handle potential database errors.
 */
export function setBookmarksChannel(guildId, bookmarksChannelId) {
	setBookmarksChannelStatement.run({ id: guildId, bookmarksChannelId });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function setQuotesChannel(guildId, quotesChannelId) {
	setQuotesChannelStatement.run({ id: guildId, quotesChannelId });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function setLanguage(guildId, language) {
	setLanguageStatement.run({ id: guildId, language });
}

/**
 * @throws Caller has to handle potential database errors.
 */
function getRolePlayChannelIds(guildId) {
	return getRolePlayChannelsDataStatement.all({ guildId }).map(row => row.role_play_channel_id);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function addRolePlayChannel(guildId, rolePlayChannelId, webhookId) {
	addRolePlayChannelStatement.run({ guildId, rolePlayChannelId, webhookId });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function removeRolePlayChannel(guildId, rolePlayChannelId) {
	removeRolePlayChannelStatement.run({ guildId, rolePlayChannelId });
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function removeAllRolePlayChannels(guildId) {
	removeAllRolePlayChannelsStatement.run({ guildId });
}

/**
 * Returns the webhook id saved for a role-play channel with the provided id in the guild with the provided id.
 * If this channel is not configured as a role-play channel in this server, null is returned.
 * Note that the webhook might be invalid.
 * @throws Caller has to handle potential database errors.
 */
export function getWebhookIdForRolePlayChannel(guildId, rolePlayChannelId) {
	const result = getWebhookIdForRolePlayChannelStatement.get({ guildId, rolePlayChannelId });
	return result?.webhook_id ?? null;
}

/**
 * Return an array of the webhook ids saved for each role-play channel in the guild with the provided id.
 * If there are no role-play channels configured for this guild, an empty array is returned.
 * Note that the webhooks might be invalid.
 * @throws Caller has to handle potential database errors.
 */
export function getWebhookIdsForRolePlayChannels(guildId) {
	return getRolePlayChannelsDataStatement.all({ guildId }).map(row => row.webhook_id);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function getRolePlayChannelsData(guildId) {
	return getRolePlayChannelsDataStatement.all({ guildId }).map(row => ({
		rolePlayChannelId: row.role_play_channel_id,
		webhookId: row.webhook_id
	}));
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function setWebhookIdForRolePlayChannel(guildId, rolePlayChannelId, webhookId) {
	setWebhookIdForRolePlayChannelStatement.run({ guildId, rolePlayChannelId, webhookId });
}
