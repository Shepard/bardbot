import db from './database.js';

const getGuildConfigStatement = db.prepare(
	'SELECT bookmarks_channel_id, quotes_channel_id FROM guild_config WHERE id = ?'
);
const setBookmarksChannelStatement = db.prepare(`INSERT INTO guild_config(id, bookmarks_channel_id) VALUES(?, ?)
	ON CONFLICT(id) DO UPDATE SET bookmarks_channel_id = ?`);
const setQuotesChannelStatement = db.prepare(`INSERT INTO guild_config(id, quotes_channel_id) VALUES(?, ?)
	ON CONFLICT(id) DO UPDATE SET quotes_channel_id = ?`);
const setChannelsStatement =
	db.prepare(`INSERT INTO guild_config(id, bookmarks_channel_id, quotes_channel_id) VALUES(?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET bookmarks_channel_id = ?, quotes_channel_id = ?`);
const removeGuildConfigStatement = db.prepare('DELETE FROM guild_config WHERE id = ?');
const getRolePlayChannelsStatement = db.prepare(
	'SELECT role_play_channel_id FROM guild_role_play_channels WHERE guild_id = ?'
);
const addRolePlayChannelStatement = db.prepare(
	'INSERT OR IGNORE INTO guild_role_play_channels(guild_id, role_play_channel_id) VALUES(?, ?)'
);
const removeRolePlayChannelStatement = db.prepare(
	'DELETE FROM guild_role_play_channels WHERE guild_id = ? AND role_play_channel_id = ?'
);
const removeAllRolePlayChannelsStatement = db.prepare('DELETE FROM guild_role_play_channels WHERE guild_id = ?');

/**
 * Tries to retrieve configuration for a guild from the database.
 * If no information is present in the database or if an error occurred while querying the database,
 * this is handled and a minimal configuration object is returned.
 */
export function getGuildConfig(guildId) {
	try {
		const config = getGuildConfigStatement.get(guildId);
		if (config) {
			const rolePlayChannels = getRolePlayChannels(guildId);
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
 * @throws Caller has to handle potential database errors.
 */
export function setConfigurationValues(guildId, patch) {
	if (patch.bookmarksChannelId && patch.quotesChannelId) {
		// In the future when there's more settings to set, just fetch the current configuration,
		// change its values with the patch and send an update - or insert a new row if no configuration existed.
		// Thus handling the upsert ourselves and not having an upsert statement for all possible combinations of settings.
		setChannelsStatement.run(
			guildId,
			patch.bookmarksChannelId,
			patch.quotesChannelId,
			patch.bookmarksChannelId,
			patch.quotesChannelId
		);
	} else if (patch.bookmarksChannelId) {
		setBookmarksChannelStatement.run(guildId, patch.bookmarksChannelId, patch.bookmarksChannelId);
	} else if (patch.quotesChannelId) {
		setQuotesChannelStatement.run(guildId, patch.quotesChannelId, patch.quotesChannelId);
	}
}

/**
 * @throws Caller has to handle potential database errors.
 */
export const clearConfigurationValues = db.transaction(guildId => {
	removeGuildConfigStatement.run(guildId);
	removeAllRolePlayChannels(guildId);
});

/**
 * @throws Caller has to handle potential database errors.
 */
export function setBookmarksChannel(guildId, bookmarksChannelId) {
	setBookmarksChannelStatement.run(guildId, bookmarksChannelId, bookmarksChannelId);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function setQuotesChannel(guildId, quotesChannelId) {
	setQuotesChannelStatement.run(guildId, quotesChannelId, quotesChannelId);
}

/**
 * @throws Caller has to handle potential database errors.
 */
function getRolePlayChannels(guildId) {
	return getRolePlayChannelsStatement.all(guildId).map(row => row.role_play_channel_id);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function addRolePlayChannel(guildId, rolePlayChannelId) {
	addRolePlayChannelStatement.run(guildId, rolePlayChannelId);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function removeRolePlayChannel(guildId, rolePlayChannelId) {
	removeRolePlayChannelStatement.run(guildId, rolePlayChannelId);
}

/**
 * @throws Caller has to handle potential database errors.
 */
export function removeAllRolePlayChannels(guildId) {
	removeAllRolePlayChannelsStatement.run(guildId);
}
