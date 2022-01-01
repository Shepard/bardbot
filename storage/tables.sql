PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS guild_config (
	id TEXT PRIMARY KEY NOT NULL,
	bookmarks_channel_id TEXT,
	quotes_channel_id TEXT
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS guild_role_play_channel (
	guild_id TEXT NOT NULL,
	role_play_channel_id TEXT NOT NULL,
	webhook_id TEXT NOT NULL,
	PRIMARY KEY(guild_id, role_play_channel_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS alt (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id TEXT NOT NULL,
	name TEXT NOT NULL  COLLATE NOCASE,
	usable_by_id TEXT NOT NULL,
	usable_by_type TEXT NOT NULL,
	avatar_url TEXT,
	UNIQUE(guild_id, name)
);

CREATE TABLE IF NOT EXISTS message_metadata (
	message_id TEXT PRIMARY KEY NOT NULL,
	channel_id TEXT NOT NULL,
	guild_id TEXT NOT NULL,
	sent_timestamp INTEGER NOT NULL,
	interacting_user_id TEXT NOT NULL,
	message_type TEXT NOT NULL
) WITHOUT ROWID;
