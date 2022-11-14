ALTER TABLE guild_config ADD COLUMN left_timestamp INTEGER;

-- Make sure all guilds mentioned in any of the other tables have a guild_config entry so they can have a foreign key reference to it.
INSERT INTO guild_config(id)
	SELECT guild_id FROM guild_role_play_channel WHERE true
	UNION
	SELECT guild_id FROM alt WHERE true
	UNION
	SELECT guild_id FROM message_metadata WHERE true
	UNION
	SELECT guild_id FROM story WHERE true
	ON CONFLICT DO NOTHING;

-- Recreate all existing tables that reference a guild id to add a foreign key constraint to the guild_config table.
-- We'll also add indexes to the foreign key coloumns.

CREATE TABLE new_guild_role_play_channel (
	guild_id TEXT NOT NULL REFERENCES guild_config(id) ON DELETE CASCADE,
	role_play_channel_id TEXT NOT NULL,
	webhook_id TEXT NOT NULL,
	PRIMARY KEY(guild_id, role_play_channel_id)
) WITHOUT ROWID;
INSERT INTO new_guild_role_play_channel SELECT * FROM guild_role_play_channel;
DROP TABLE guild_role_play_channel;
ALTER TABLE new_guild_role_play_channel RENAME TO guild_role_play_channel;
CREATE INDEX idx__guild_role_play_channel__guild_id ON guild_role_play_channel(guild_id);

CREATE TABLE IF NOT EXISTS new_alt (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id TEXT NOT NULL REFERENCES guild_config(id) ON DELETE CASCADE,
	name TEXT NOT NULL COLLATE NOCASE,
	usable_by_id TEXT NOT NULL,
	usable_by_type TEXT NOT NULL,
	avatar_url TEXT,
	UNIQUE(guild_id, name)
);
INSERT INTO new_alt SELECT * FROM alt;
DROP TABLE alt;
ALTER TABLE new_alt RENAME TO alt;
CREATE INDEX idx__alt__guild_id ON alt(guild_id);

CREATE TABLE IF NOT EXISTS new_message_metadata (
	message_id TEXT PRIMARY KEY NOT NULL,
	channel_id TEXT NOT NULL,
	guild_id TEXT NOT NULL REFERENCES guild_config(id) ON DELETE CASCADE,
	sent_timestamp INTEGER NOT NULL,
	interacting_user_id TEXT NOT NULL,
	message_type TEXT NOT NULL
) WITHOUT ROWID;
INSERT INTO new_message_metadata SELECT * FROM message_metadata;
DROP TABLE message_metadata;
ALTER TABLE new_message_metadata RENAME TO message_metadata;
CREATE INDEX idx__message_metadata__guild_id ON message_metadata(guild_id);

CREATE TABLE IF NOT EXISTS new_story (
	id TEXT PRIMARY KEY,
	guild_id TEXT NOT NULL REFERENCES guild_config(id) ON DELETE CASCADE,
	editor_id TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
	author TEXT NOT NULL DEFAULT '',
	teaser TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL,
	last_changed_timestamp INTEGER NOT NULL,
	reported_ink_error INTEGER NOT NULL DEFAULT 0,
	reported_ink_warning INTEGER NOT NULL DEFAULT 0,
	reported_maximum_choice_number_exceeded INTEGER NOT NULL DEFAULT 0,
	reported_potential_loop_detected INTEGER NOT NULL DEFAULT 0,
	time_budget_exceeded_count INTEGER NOT NULL DEFAULT 0,
	UNIQUE(guild_id, title)
) WITHOUT ROWID;
INSERT INTO new_story SELECT * FROM story;

-- story_play doesn't need any changes since it doesn't reference guild_config.
-- But it does reference story so it would prevent us from dropping story.
-- This *could* be done in a simpler way if we follow https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes to the letter
-- and turn off foreign key enforcing during this upgrade, but that would require nested transactions (since upgrades already run in transactions)
-- and we can't do nested transactions.
CREATE TABLE IF NOT EXISTS new_story_play (
	user_id TEXT PRIMARY KEY,
	story_id TEXT NOT NULL REFERENCES new_story(id) ON DELETE CASCADE,
	state_json TEXT
) WITHOUT ROWID;
INSERT INTO new_story_play SELECT * FROM story_play;

DROP TABLE story_play;
ALTER TABLE new_story_play RENAME TO story_play;
CREATE INDEX idx__story_play__story_id ON story_play(story_id);

DROP TABLE story;
ALTER TABLE new_story RENAME TO story;
CREATE INDEX idx__story__guild_id ON story(guild_id);
