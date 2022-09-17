import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db, { FILES_DIR, registerDbInitialisedListener } from './database.js';

export const EditorReportType = Object.freeze({
	InkWarning: 'InkWarning',
	InkError: 'InkError',
	PotentialLoopDetected: 'PotentialLoopDetected',
	MaximumChoiceNumberExceeded: 'MaximumChoiceNumberExceeded'
});

export const StoryStatus = Object.freeze({
	Draft: 'Draft',
	Testing: 'Testing',
	Published: 'Published'
});

const storyFilesDir = FILES_DIR + path.sep + 'stories';
if (!fs.existsSync(storyFilesDir)) {
	fs.mkdirSync(storyFilesDir);
}

let addStoryStatement = null;
let getStoryStatement = null;
let getStoriesStatement = null;
let getPublishedStoriesStatement = null;
let findMatchingStoriesStatement = null;
let findMatchingPublishedStoriesStatement = null;
let changeStoryMetadataStatement = null;
let changeStoryEditorStatement = null;
let changeStoryStatusStatement = null;
let changeStoryStatusConditionallyStatement = null;
let markInkErrorAsReported = null;
let markInkWarningAsReported = null;
let markMaximumChoiceNumberExceededAsReported = null;
let markPotentialLoopDetectedAsReported = null;
let increaseTimeBudgetExceededCounterStatement = null;
let clearWarningFlagsAndCountersStatement = null;
let getStoryPlayStatement = null;
let hasStoryPlayStatement = null;
let addStoryPlayStatement = null;
let clearStoryPlayStatement = null;
let saveStoryPlayStateStatement = null;
let resetStoryPlayStateStatement = null;
let getCurrentPlayersStatement = null;

registerDbInitialisedListener(() => {
	addStoryStatement = db.prepare(
		'INSERT INTO story(id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp) ' +
			"VALUES(:id, :guildId, :editorId, :title, :author, :teaser, 'Draft', unixepoch())"
	);
	getStoryStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			'FROM story WHERE id = :storyId'
	);
	getStoriesStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status != 'Draft' ORDER BY title"
	);
	getPublishedStoriesStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status = 'Published' ORDER BY title"
	);
	findMatchingStoriesStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status != 'Draft' AND title LIKE :pattern ESCAPE '#' ORDER BY title"
	);
	findMatchingPublishedStoriesStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status = 'Published' AND title LIKE :pattern ESCAPE '#' ORDER BY title"
	);
	changeStoryMetadataStatement = db.prepare(
		'UPDATE story SET title = :title, author = :author, teaser = :teaser, last_changed_timestamp = unixepoch() WHERE id = :storyId'
	);
	// Changing the story editor clears all reporting flags (but not the counter, since that could be abused).
	// Since someone else is now responsible for warnings about this story, they might not have seen existing ones before.
	changeStoryEditorStatement = db.prepare(
		'UPDATE story SET editor_id = :editorId, last_changed_timestamp = unixepoch(), reported_ink_error = 0, reported_ink_warning = 0, ' +
			'reported_maximum_choice_number_exceeded = 0, reported_potential_loop_detected = 0 WHERE id = :storyId'
	);
	changeStoryStatusStatement = db.prepare(
		'UPDATE story SET status = :status, last_changed_timestamp = unixepoch() WHERE id = :storyId'
	);
	changeStoryStatusConditionallyStatement = db.prepare(
		'UPDATE story SET status = :status, last_changed_timestamp = unixepoch() WHERE id = :storyId AND status = :previousExpectedStatus'
	);
	markInkErrorAsReported = db.prepare(
		'UPDATE story SET reported_ink_error = 1, last_changed_timestamp = unixepoch() WHERE id = :storyId'
	);
	markInkWarningAsReported = db.prepare(
		'UPDATE story SET reported_ink_warning = 1, last_changed_timestamp = unixepoch() WHERE id = :storyId'
	);
	markMaximumChoiceNumberExceededAsReported = db.prepare(
		'UPDATE story SET reported_maximum_choice_number_exceeded = 1, last_changed_timestamp = unixepoch() WHERE id = :storyId'
	);
	markPotentialLoopDetectedAsReported = db.prepare(
		'UPDATE story SET reported_potential_loop_detected = 1, last_changed_timestamp = unixepoch() WHERE id = :storyId'
	);
	increaseTimeBudgetExceededCounterStatement = db.prepare(
		'UPDATE story SET time_budget_exceeded_count = time_budget_exceeded_count + 1, last_changed_timestamp = unixepoch() WHERE id = :storyId'
	);
	clearWarningFlagsAndCountersStatement = db.prepare(
		'UPDATE story SET reported_ink_error = 0, reported_ink_warning = 0, reported_maximum_choice_number_exceeded = 0, ' +
			'reported_potential_loop_detected = 0, time_budget_exceeded_count = 0, last_changed_timestamp = unixepoch() WHERE id = :storyId'
	);
	getStoryPlayStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count, ' +
			'state_json FROM story s JOIN story_play p ON s.id = p.story_id WHERE p.user_id = :userId'
	);
	hasStoryPlayStatement = db.prepare('SELECT story_id FROM story_play WHERE user_id = :userId').pluck();
	addStoryPlayStatement = db.prepare('INSERT INTO story_play(user_id, story_id) VALUES(:userId, :storyId)');
	clearStoryPlayStatement = db.prepare('DELETE FROM story_play WHERE user_id = :userId');
	saveStoryPlayStateStatement = db.prepare('UPDATE story_play SET state_json = :stateJson WHERE user_id = :userId');
	resetStoryPlayStateStatement = db.prepare('UPDATE story_play SET state_json = NULL WHERE user_id = :userId');
	getCurrentPlayersStatement = db.prepare('SELECT user_id FROM story_play WHERE story_id = :storyId').pluck();
});

export async function addStory(storyContent, { title = '', author = '', teaser = '' }, editorId, guildId) {
	let id;
	let inserted = false;
	let attempts = 0;
	while (!inserted && attempts < 10) {
		id = uuidv4();
		try {
			addStoryStatement.run({ id, guildId, editorId, title, author, teaser });
			inserted = true;
		} catch (error) {
			if (error.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') {
				throw error;
			}
			attempts++;
		}
	}
	if (!inserted) {
		// It is veeery unlikely to generate the same uuid twice in the first place.
		// Ending up here should be virtually impossible.
		// This is basically just a safety measure to make sure we exit the loop in case something goes wrong with, e.g., the error codes.
		throw new Error('Too many attempts to generate unique id for story, aborting creation.');
	}

	await writeStoryFile(id, storyContent);

	return id;
}

/**
 * Tries to find a story for a given story id in the database.
 * @returns An object containing various properties about the story - or null if no story was found.
 * @throws Caller has to handle potential database errors.
 */
// TODO pass guildId as well and validate against that. probably return null if it doesn't match? check all callers.
export function getStory(storyId) {
	const row = getStoryStatement.get({ storyId });
	if (row) {
		return mapRowToStoryRecord(row);
	}
	return null;
}

export function getStories(guildId, publishedOnly) {
	let statement;
	if (publishedOnly) {
		statement = getPublishedStoriesStatement;
	} else {
		statement = getStoriesStatement;
	}
	return statement.all({ guildId }).map(mapRowToStoryRecord);
}

export function findMatchingStories(guildId, searchInput, logger, publishedOnly) {
	try {
		// TODO extract method, used by this and alt-dao
		const escapedSearchInput = searchInput.replaceAll('#', '##').replaceAll('%', '#%').replaceAll('_', '#_');
		const pattern = '%' + escapedSearchInput + '%';
		let statement;
		if (publishedOnly) {
			statement = findMatchingPublishedStoriesStatement;
		} else {
			statement = findMatchingStoriesStatement;
		}
		return statement.all({ guildId, pattern }).map(mapRowToStoryRecord);
	} catch (e) {
		logger.error(e);
		return [];
	}
}

function mapRowToStoryRecord(row) {
	return {
		id: row.id,
		guildId: row.guild_id,
		editorId: row.editor_id,
		title: row.title,
		author: row.author,
		teaser: row.teaser,
		status: row.status,
		lastChanged: row.last_changed_timestamp,
		reportedInkError: !!row.reported_ink_error,
		reportedInkWarning: !!row.reported_ink_warning,
		reportedMaximumChoiceNumberExceeded: !!row.reported_maximum_choice_number_exceeded,
		reportedPotentialLoopDetected: !!row.reported_potential_loop_detected,
		timeBudgetExceededCount: row.time_budget_exceeded_count
	};
}

export async function replaceStoryContent(storyId, storyContent) {
	await writeStoryFile(storyId, storyContent);
	clearWarningFlagsAndCounters(storyId);
}

async function writeStoryFile(storyId, storyContent) {
	await fsPromises.writeFile(getStoryFilePath(storyId), storyContent);
}

function getStoryFilePath(storyId) {
	return storyFilesDir + path.sep + storyId + '.json';
}

export async function loadStoryContent(storyId) {
	return await fsPromises.readFile(getStoryFilePath(storyId), 'UTF-8');
}

export function changeStoryMetadata(storyId, { title, author = '', teaser = '' }) {
	return db.transaction(() => {
		const info = changeStoryMetadataStatement.run({ title, author, teaser, storyId });
		if (info.changes > 0) {
			moveStoryToTesting(storyId);
			return true;
		}
		return false;
	})();
}

export function changeStoryEditor(storyId, editorId) {
	const info = changeStoryEditorStatement.run({ editorId, storyId });
	return info.changes > 0;
}

export function moveStoryToTesting(storyId) {
	return setStatus(storyId, StoryStatus.Testing, StoryStatus.Draft);
}

export function publishStory(storyId) {
	return setStatus(storyId, StoryStatus.Published);
}

function setStatus(storyId, status, previousExpectedStatus) {
	let info;
	if (previousExpectedStatus) {
		info = changeStoryStatusConditionallyStatement.run({ status, storyId, previousExpectedStatus });
	} else {
		info = changeStoryStatusStatement.run({ status, storyId });
	}
	return info.changes > 0;
}

// TODO if story is a prototype instance, this could be a function on the prototype.
export function hasIssueBeenReported(story, editorReportType) {
	switch (editorReportType) {
		case EditorReportType.InkError:
			return story.reportedInkError;
		case EditorReportType.InkWarning:
			return story.reportedInkWarning;
		case EditorReportType.MaximumChoiceNumberExceeded:
			return story.reportedMaximumChoiceNumberExceeded;
		case EditorReportType.PotentialLoopDetected:
			return story.reportedPotentialLoopDetected;
		default:
			return false;
	}
}

export function markIssueAsReported(storyId, editorReportType) {
	let info = null;
	switch (editorReportType) {
		case EditorReportType.InkError:
			info = markInkErrorAsReported.run({ storyId });
			break;
		case EditorReportType.InkWarning:
			info = markInkWarningAsReported.run({ storyId });
			break;
		case EditorReportType.MaximumChoiceNumberExceeded:
			info = markMaximumChoiceNumberExceededAsReported.run({ storyId });
			break;
		case EditorReportType.PotentialLoopDetected:
			info = markPotentialLoopDetectedAsReported.run({ storyId });
			break;
		default:
		// TODO throw error?
	}
	return info?.changes > 0;
}

export function increaseTimeBudgetExceededCounter(storyId) {
	const info = increaseTimeBudgetExceededCounterStatement.run({ storyId });
	return info.changes > 0;
}

function clearWarningFlagsAndCounters(storyId) {
	const info = clearWarningFlagsAndCountersStatement.run({ storyId });
	return info.changes > 0;
}

// TODO deleteStory; will delete db record, current and past plays (automatically via cascade) and file

/**
 * Tries to find the currently running story for a given user id in the database.
 * If no entry is present in the database or if an error occurred while querying the database,
 * this is handled and null is returned.
 */
// TODO caller should handle error
export function getCurrentStoryPlay(userId) {
	const row = getStoryPlayStatement.get({ userId });
	if (row) {
		return {
			storyRecord: mapRowToStoryRecord(row),
			storyState: row.state_json
		};
	}
	return null;
}

// TODO caller should handle error
export function hasCurrentStoryPlay(userId) {
	return !!hasStoryPlayStatement.get({ userId });
}

export function saveCurrentStoryPlay(userId, storyId) {
	addStoryPlayStatement.run({ userId, storyId });
}

export function clearCurrentStoryPlay(userId) {
	clearStoryPlayStatement.run({ userId });
}

export function saveStoryPlayState(userId, stateJson) {
	saveStoryPlayStateStatement.run({ userId, stateJson });
}

export function resetStoryPlayState(userId) {
	resetStoryPlayStateStatement.run({ userId });
}

export function getCurrentPlayers(storyId) {
	return getCurrentPlayersStatement.all({ storyId });
}

// TODO methods for saving, querying and clearing past plays
