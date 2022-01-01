import db, { registerDbInitialisedListener } from './database.js';

let getGuildConfigStatement = null;
let getGuildIdsForGuildsWithConfigurationStatement = null;
let setBookmarksChannelStatement = null;
let setQuotesChannelStatement = null;
let setChannelsStatement = null;
let removeGuildConfigStatement = null;

let getRolePlayChannelsDataStatement = null;
let addRolePlayChannelStatement = null;
let removeRolePlayChannelStatement = null;
let removeAllRolePlayChannelsStatement = null;
let getWebhookIdForRolePlayChannelStatement = null;
let setWebhookIdForRolePlayChannelStatement = null;

registerDbInitialisedListener(() => {
	getGuildConfigStatement = db.prepare(
		'SELECT bookmarks_channel_id, quotes_channel_id FROM guild_config WHERE id = :id'
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
	setChannelsStatement = db.prepare(
		'INSERT INTO guild_config(id, bookmarks_channel_id, quotes_channel_id)' +
			' VALUES(:id, :bookmarksChannelId, :quotesChannelId)' +
			' ON CONFLICT(id) DO UPDATE SET bookmarks_channel_id = :bookmarksChannelId, quotes_channel_id = :quotesChannelId'
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
export function getGuildConfig(guildId) {
	try {
		const config = getGuildConfigStatement.get({ id: guildId });
		if (config) {
			const rolePlayChannels = getRolePlayChannelIds(guildId);
			return {
				id: config.id,
				bookmarksChannel: config.bookmarks_channel_id,
				quotesChannel: config.quotes_channel_id,
				rolePlayChannels
			};
		}
		return { id: guildId };
	} catch (e) {
		console.error(e);
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
		console.error(e);
		return [];
	}
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function setConfigurationValues(guildId, patch) {
	if (patch.bookmarksChannelId && patch.quotesChannelId) {
		// In the future when there's more settings to set, just fetch the current configuration,
		// change its values with the patch and send an update - or insert a new row if no configuration existed.
		// Thus handling the upsert ourselves and not having an upsert statement for all possible combinations of settings.
		setChannelsStatement.run({
			id: guildId,
			bookmarksChannelId: patch.bookmarksChannelId,
			quotesChannelId: patch.quotesChannelId
		});
	} else if (patch.bookmarksChannelId) {
		setBookmarksChannelStatement.run({ id: guildId, bookmarksChannelId: patch.bookmarksChannelId });
	} else if (patch.quotesChannelId) {
		setQuotesChannelStatement.run({ id: guildId, quotesChannelId: patch.quotesChannelId });
	}
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
