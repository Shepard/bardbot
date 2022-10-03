CREATE TABLE IF NOT EXISTS story (
	id TEXT PRIMARY KEY,
	guild_id TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS story_play (
	user_id TEXT PRIMARY KEY,
	story_id TEXT NOT NULL REFERENCES story(id) ON DELETE CASCADE,
	state_json TEXT
) WITHOUT ROWID;

CREATE INDEX idx__story_play__story_id ON story_play(story_id);