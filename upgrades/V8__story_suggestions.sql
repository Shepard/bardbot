CREATE TABLE IF NOT EXISTS story_suggestion (
	source_story_id TEXT NOT NULL REFERENCES story(id) ON DELETE CASCADE,
	target_story_id TEXT NOT NULL REFERENCES story(id) ON DELETE CASCADE,
	message TEXT NOT NULL DEFAULT '',
	PRIMARY KEY(source_story_id, target_story_id),
	CHECK(source_story_id != target_story_id)
) WITHOUT ROWID;