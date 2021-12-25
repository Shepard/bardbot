CREATE TABLE IF NOT EXISTS guild_config (
	id TEXT PRIMARY KEY,
	bookmarks_channel_id TEXT,
	quotes_channel_id TEXT
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS guild_role_play_channels (
	guild_id TEXT,
	role_play_channel_id TEXT,
	PRIMARY KEY(guild_id, role_play_channel_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS message_metadata (
	message_id TEXT PRIMARY KEY,
	channel_id TEXT NOT NULL,
	guild_id TEXT NOT NULL,
	sent_timestamp INTEGER NOT NULL,
	interacting_user_id TEXT NOT NULL,
	message_type TEXT NOT NULL
) WITHOUT ROWID;
