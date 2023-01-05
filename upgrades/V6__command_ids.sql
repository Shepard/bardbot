CREATE TABLE IF NOT EXISTS global_command_id (
	command_name TEXT PRIMARY KEY NOT NULL,
	command_id TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS guild_command_id (
	guild_id TEXT NOT NULL REFERENCES guild_config(id) ON DELETE CASCADE,
	command_name TEXT NOT NULL,
	command_id TEXT NOT NULL,
	PRIMARY KEY(guild_id, command_name)
) WITHOUT ROWID;