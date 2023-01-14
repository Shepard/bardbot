-- Recreating the story table to fix some constraints.
-- 'title' is not generally "NOT NULL" anymore but there's now a CHECK constraint that prevents it from being NULL when it's not in status 'Draft'.
-- That way there can be multiple drafts without titles, since null values are apparently different "from each other" for the purpose of unique constraints.
CREATE TABLE IF NOT EXISTS new_story (
	id TEXT PRIMARY KEY,
	guild_id TEXT NOT NULL REFERENCES guild_config(id) ON DELETE CASCADE,
	owner_id TEXT NOT NULL,
	title TEXT COLLATE NOCASE,
	author TEXT NOT NULL DEFAULT '',
	teaser TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL,
	last_changed_timestamp INTEGER NOT NULL,
	reported_ink_error INTEGER NOT NULL DEFAULT 0,
	reported_ink_warning INTEGER NOT NULL DEFAULT 0,
	reported_maximum_choice_number_exceeded INTEGER NOT NULL DEFAULT 0,
	reported_potential_loop_detected INTEGER NOT NULL DEFAULT 0,
	time_budget_exceeded_count INTEGER NOT NULL DEFAULT 0,
	UNIQUE(guild_id, title),
	CHECK(title NOT NULL OR status = 'Draft')
) WITHOUT ROWID;
INSERT INTO new_story SELECT * FROM story;

-- Recreate story_play as well since it has a foreign key constraint on story, preventing us to drop story.
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