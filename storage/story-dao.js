import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db, { FILES_DIR, registerDbInitialisedListener } from './database.js';
import { escapeSearchInputToLikePattern } from '../util/helpers.js';

export const EditorReportType = Object.freeze({
	InkWarning: 'InkWarning',
	InkError: 'InkError',
	PotentialLoopDetected: 'PotentialLoopDetected',
	MaximumChoiceNumberExceeded: 'MaximumChoiceNumberExceeded'
});

export const StoryStatus = Object.freeze({
	Draft: 'Draft',
	Testing: 'Testing',
	Published: 'Published',
	ToBeDeleted: 'ToBeDeleted'
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
let countStoriesStatement = null;
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
let getStoriesToDeleteStatement = null;
let deleteObsoleteStoriesStatement = null;
let getStoryPlayStatement = null;
let hasStoryPlayStatement = null;
let addStoryPlayStatement = null;
let clearStoryPlayStatement = null;
let clearStoryPlaysStatement = null;
let saveStoryPlayStateStatement = null;
let resetStoryPlayStateStatement = null;
let getCurrentPlayersStatement = null;

registerDbInitialisedListener(() => {
	addStoryStatement = db.prepare(
		'INSERT INTO story(id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp) ' +
			"VALUES(:id, :guildId, :editorId, :title, :author, :teaser, 'Draft', unixepoch())"
	);
	// Even though the id is unique across all guilds, this still validates if the story is for the right guild.
	// Otherwise, with a very small chance, a story in guild A might get deleted, freeing up its id, and a story in guild B gets created with the same UUID.
	getStoryStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			'FROM story WHERE id = :storyId AND guild_id = :guildId'
	);
	getStoriesStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status != 'Draft' AND status != 'ToBeDeleted' ORDER BY title"
	);
	getPublishedStoriesStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status = 'Published' ORDER BY title"
	);
	findMatchingStoriesStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status != 'Draft' AND status != 'ToBeDeleted' AND title LIKE :pattern ESCAPE '#' ORDER BY title"
	);
	findMatchingPublishedStoriesStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status = 'Published' AND title LIKE :pattern ESCAPE '#' ORDER BY title"
	);
	countStoriesStatement = db
		.prepare("SELECT count(id) FROM story WHERE guild_id = :guildId AND status != 'Draft' AND status != 'ToBeDeleted'")
		.pluck();
	changeStoryMetadataStatement = db.prepare(
		'UPDATE story SET title = :title, author = :author, teaser = :teaser, last_changed_timestamp = unixepoch() WHERE id = :storyId AND guild_id = :guildId'
	);
	// Changing the story editor clears all reporting flags (but not the counter, since that could be abused).
	// Since someone else is now responsible for warnings about this story, they might not have seen existing ones before.
	changeStoryEditorStatement = db.prepare(
		'UPDATE story SET editor_id = :editorId, last_changed_timestamp = unixepoch(), reported_ink_error = 0, reported_ink_warning = 0, ' +
			'reported_maximum_choice_number_exceeded = 0, reported_potential_loop_detected = 0 WHERE id = :storyId AND guild_id = :guildId'
	);
	changeStoryStatusStatement = db.prepare(
		'UPDATE story SET status = :status, last_changed_timestamp = unixepoch() WHERE id = :storyId AND guild_id = :guildId'
	);
	changeStoryStatusConditionallyStatement = db.prepare(
		'UPDATE story SET status = :status, last_changed_timestamp = unixepoch() WHERE id = :storyId AND guild_id = :guildId AND status = :previousExpectedStatus'
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
	// We could use unixepoch() here but the advantage of passing it in from the outside is that
	// we can pass the same value to the delete query to make sure they return the same result.
	getStoriesToDeleteStatement = db
		.prepare(
			"SELECT id FROM story WHERE status == 'Draft' OR status == 'ToBeDeleted' AND :secondsSinceEpoch - last_changed_timestamp > 60 * 60 * 24"
		)
		.pluck();
	// This should also delete related plays via ON DELETE CASCADE.
	// TODO later: test this for past plays once implemented. current plays won't exist for stories in that status anyway.
	deleteObsoleteStoriesStatement = db.prepare(
		"DELETE FROM story WHERE status == 'Draft' OR status == 'ToBeDeleted' AND :secondsSinceEpoch - last_changed_timestamp > 60 * 60 * 24"
	);
	getStoryPlayStatement = db.prepare(
		'SELECT id, guild_id, editor_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count, ' +
			'state_json FROM story s JOIN story_play p ON s.id = p.story_id WHERE p.user_id = :userId'
	);
	hasStoryPlayStatement = db.prepare('SELECT story_id FROM story_play WHERE user_id = :userId').pluck();
	addStoryPlayStatement = db.prepare('INSERT INTO story_play(user_id, story_id) VALUES(:userId, :storyId)');
	clearStoryPlayStatement = db.prepare('DELETE FROM story_play WHERE user_id = :userId');
	clearStoryPlaysStatement = db.prepare('DELETE FROM story_play WHERE story_id = :storyId');
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
export function getStory(storyId, guildId) {
	const row = getStoryStatement.get({ storyId, guildId });
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
		const pattern = escapeSearchInputToLikePattern(searchInput);
		let statement;
		if (publishedOnly) {
			statement = findMatchingPublishedStoriesStatement;
		} else {
			statement = findMatchingStoriesStatement;
		}
		return statement.all({ guildId, pattern }).map(mapRowToStoryRecord);
	} catch (e) {
		logger.error(
			e,
			'Error while trying to find matching stories in guild %s for search string %s',
			guildId,
			searchInput
		);
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

/**
 * Counts the number of stories that exist in a guild.
 * @param {string} guildId The id of the guild to search.
 * @returns {number} The number of stories that exist. 0 if there are none or if an error occurred during the database fetching.
 */
export function getNumberOfStories(guildId, logger) {
	try {
		const result = countStoriesStatement.get({ guildId });
		return result ?? 0;
	} catch (error) {
		logger.error(error, 'Error while trying to count stories in guild %', guildId);
		return 0;
	}
}

export async function replaceStoryContent(storyId, storyContent) {
	await writeStoryFile(storyId, storyContent);
	clearWarningFlagsAndCounters(storyId);
}

async function writeStoryFile(storyId, storyContent) {
	await fsPromises.writeFile(getStoryFilePath(storyId), storyContent);
}

async function deleteStoryFile(storyId) {
	await fsPromises.rm(getStoryFilePath(storyId));
}

function getStoryFilePath(storyId) {
	return storyFilesDir + path.sep + storyId + '.json';
}

export async function loadStoryContent(storyId) {
	return await fsPromises.readFile(getStoryFilePath(storyId), 'UTF-8');
}

export function changeStoryMetadata(storyId, guildId, { title, author = '', teaser = '' }) {
	return db.transaction(() => {
		const info = changeStoryMetadataStatement.run({ title, author, teaser, storyId, guildId });
		if (info.changes > 0) {
			moveStoryToTesting(storyId, guildId);
			return true;
		}
		return false;
	})();
}

export function changeStoryEditor(storyId, guildId, editorId) {
	const info = changeStoryEditorStatement.run({ editorId, storyId, guildId });
	return info.changes > 0;
}

function moveStoryToTesting(storyId, guildId) {
	return setStoryStatus(storyId, guildId, StoryStatus.Testing, StoryStatus.Draft);
}

export function publishStory(storyId, guildId) {
	return setStoryStatus(storyId, guildId, StoryStatus.Published);
}

/**
 * Marks a story for automatic deletion at a later point (by setting its status to ToBeDeleted).
 * The story will not appear in any lists or searches anymore.
 * Also clears current plays for everyone playing the story.
 * @returns The story record of the story in its state before being marked for deletion, so that it can be restored later on, or null if the story was not found.
 */
export function markStoryForDeletion(storyId, guildId) {
	return db.transaction(() => {
		const story = getStory(storyId, guildId);
		if (story) {
			setStoryStatus(storyId, guildId, StoryStatus.ToBeDeleted);
			clearCurrentStoryPlays(storyId);
			return story;
		}
		return null;
	})();
}

export function setStoryStatus(storyId, guildId, status, previousExpectedStatus) {
	let info;
	if (previousExpectedStatus) {
		info = changeStoryStatusConditionallyStatement.run({ status, storyId, guildId, previousExpectedStatus });
	} else {
		info = changeStoryStatusStatement.run({ status, storyId, guildId });
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
			throw new Error('Unknown editor report type: ' + editorReportType);
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

export async function cleanupStories(logger) {
	const storyIds = db.transaction(() => {
		const secondsSinceEpoch = Math.floor(Date.now() / 1000);
		const storiesToDelete = getStoriesToDeleteStatement.all({ secondsSinceEpoch });
		const info = deleteObsoleteStoriesStatement.run({ secondsSinceEpoch });
		if (info.changes !== storiesToDelete.length) {
			// This should not happen since we only use one db connection so far and everything runs on it in serial.
			logger.error(
				'Number of selected stories to delete (%d) did not match number of stories deleted (%d) in cleanup.',
				storiesToDelete.length,
				info.changes
			);
		}
		return storiesToDelete;
	})();

	await Promise.allSettled(
		storyIds.map(storyId =>
			deleteStoryFile(storyId).catch(error =>
				logger.error(error, 'Error while trying to delete file for story %s', storyId)
			)
		)
	);

	return storyIds.length;
}

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

export function hasCurrentStoryPlay(userId) {
	return !!hasStoryPlayStatement.get({ userId });
}

export function saveCurrentStoryPlay(userId, storyId) {
	addStoryPlayStatement.run({ userId, storyId });
}

export function clearCurrentStoryPlay(userId) {
	clearStoryPlayStatement.run({ userId });
}

function clearCurrentStoryPlays(storyId) {
	clearStoryPlaysStatement.run({ storyId });
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

// TODO later: methods for saving, querying and clearing past plays
