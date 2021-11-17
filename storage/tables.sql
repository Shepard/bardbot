CREATE TABLE IF NOT EXISTS guild_config (
	id TEXT PRIMARY KEY,
	bookmarks_channel_id TEXT,
	quotes_channel_id TEXT
) WITHOUT ROWID;