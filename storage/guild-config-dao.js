import db from './database.js';

const getGuildConfigStatement = db.prepare('SELECT bookmarks_channel_id, quotes_channel_id FROM guild_config WHERE id = ?');
const setBookmarksChannelStatement = db.prepare(`INSERT INTO guild_config(id, bookmarks_channel_id) VALUES(?, ?)
	ON CONFLICT(id) DO UPDATE SET bookmarks_channel_id = ?`);
const setQuotesChannelStatement = db.prepare(`INSERT INTO guild_config(id, quotes_channel_id) VALUES(?, ?)
	ON CONFLICT(id) DO UPDATE SET quotes_channel_id = ?`);

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
export function setBookmarksChannel(guildId, bookmarksChannelId) {
	setBookmarksChannelStatement.run(guildId, bookmarksChannelId, bookmarksChannelId);
}

/**
 * Caller has to handle potential errors.
 */
export function setQuotesChannel(guildId, quotesChannelId) {
	setQuotesChannelStatement.run(guildId, quotesChannelId, quotesChannelId);
}