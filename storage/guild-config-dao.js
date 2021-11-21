import db from './database.js';

const getGuildConfigStatement = db.prepare('SELECT bookmarks_channel_id, quotes_channel_id FROM guild_config WHERE id = ?');
const setBookmarksChannelStatement = db.prepare(`INSERT INTO guild_config(id, bookmarks_channel_id) VALUES(?, ?)
	ON CONFLICT(id) DO UPDATE SET bookmarks_channel_id = ?`);
const setQuotesChannelStatement = db.prepare(`INSERT INTO guild_config(id, quotes_channel_id) VALUES(?, ?)
	ON CONFLICT(id) DO UPDATE SET quotes_channel_id = ?`);
const setChannelsStatement = db.prepare(`INSERT INTO guild_config(id, bookmarks_channel_id, quotes_channel_id) VALUES(?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET bookmarks_channel_id = ?, quotes_channel_id = ?`);
const removeGuildConfigStatement = db.prepare('DELETE FROM guild_config WHERE id = ?');

/**
 * Tries to retrieve configuration for a guild from the database.
 * If no information is present in the database or if an error occurred while querying the database,
 * this is handled and a minimal configuration object is returned.
 */
export function getGuildConfig(guildId) {
	try {
		const config = getGuildConfigStatement.get(guildId);
		if (config) {
			return {
				id: config.id,
				bookmarksChannel: config.bookmarks_channel_id,
				quotesChannel: config.quotes_channel_id
			};
		}
		return { id: guildId };
	} catch (e) {
		console.error(e);
		return { id: guildId };
	}
}

/**
 * Caller has to handle potential errors.
 */
export function setConfigurationValues(guildId, patch) {
	if (patch.bookmarksChannelId && patch.quotesChannelId) {
		// In the future when there's more settings to set, just fetch the current configuration,
		// change its values with the patch and send an update - or insert a new row if no configuration existed.
		// Thus handling the upsert ourselves and not having an upsert statement for all possible combinations of settings.
		setChannelsStatement.run(guildId, patch.bookmarksChannelId, patch.quotesChannelId, patch.bookmarksChannelId, patch.quotesChannelId);
	} else if (patch.bookmarksChannelId) {
		setBookmarksChannelStatement.run(guildId, patch.bookmarksChannelId, patch.bookmarksChannelId);
	} else if (patch.quotesChannelId) {
		setQuotesChannelStatement.run(guildId, patch.quotesChannelId, patch.quotesChannelId);
	}
}

/**
 * Caller has to handle potential errors.
 */
export function clearConfigurationValues(guildId) {
	removeGuildConfigStatement.run(guildId);
	// In the future this might have to update other tables too.
	// Do that in a transaction then.
}

/**
 * Caller has to handle potential errors.
 */
export function setBookmarksChannel(guildId, bookmarksChannelId) {
	setBookmarksChannelStatement.run(guildId, bookmarksChannelId, bookmarksChannelId);
}

/**
 * Caller has to handle potential errors.
 */
export function setQuotesChannel(guildId, quotesChannelId) {
	setQuotesChannelStatement.run(guildId, quotesChannelId, quotesChannelId);
}