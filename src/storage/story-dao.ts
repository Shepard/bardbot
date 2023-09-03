import Database, { Statement } from 'better-sqlite3';
import fsPromises from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'pino';
import {
	OwnerReportType,
	StoryStatus,
	StoryRecord,
	StoryPlay,
	StorySuggestion,
	SuggestionData
} from './record-types.js';
import { StoryMetadata } from '../story/story-types.js';
import db, { FILES_DIR, registerDbInitialisedListener } from './database.js';
import { ensureGuildConfigurationExists, obsoleteGuildsSelect } from './guild-config-dao.js';
import { escapeSearchInputToLikePattern } from '../util/helpers.js';

const storyFilesDir = FILES_DIR + path.sep + 'stories';
await fsPromises.mkdir(storyFilesDir, { recursive: true });

let addStoryStatement: Statement = null;
let getStoryStatement: Statement = null;
let getStoriesStatement: Statement = null;
let getPublishedStoriesStatement: Statement = null;
let findMatchingStoriesStatement: Statement = null;
let findMatchingPublishedStoriesStatement: Statement = null;
let countStoriesStatement: Statement = null;
let countAllStoriesStatement: Statement = null;
let changeStoryMetadataStatement: Statement = null;
let changeStoryOwnerStatement: Statement = null;
let changeStoryStatusStatement: Statement = null;
let changeStoryStatusConditionallyStatement: Statement = null;
let deleteStoryStatement: Statement = null;
let markInkErrorAsReported: Statement = null;
let markInkWarningAsReported: Statement = null;
let markMaximumChoiceNumberExceededAsReported: Statement = null;
let markPotentialLoopDetectedAsReported: Statement = null;
let increaseTimeBudgetExceededCounterStatement: Statement = null;
let clearWarningFlagsAndCountersStatement: Statement = null;
let getStoriesToDeleteStatement: Statement = null;
let getStoriesToDeleteForObsoleteGuildsStatement: Statement = null;
let deleteObsoleteStoriesStatement: Statement = null;
let deleteStoriesForObsoleteGuildsStatement: Statement = null;
let getStoryPlayStatement: Statement = null;
let hasStoryPlayStatement: Statement = null;
let addStoryPlayStatement: Statement = null;
let clearStoryPlayStatement: Statement = null;
let clearStoryPlaysStatement: Statement = null;
let saveStoryPlayStateStatement: Statement = null;
let resetStoryPlayStateStatement: Statement = null;
let getCurrentPlayersStatement: Statement = null;
let addOrEditStorySuggestionStatement: Statement = null;
let getStorySuggestionStatement: Statement = null;
let getSuggestedStoriesStatement: Statement = null;
let getStorySuggestionsStatement: Statement = null;
let deleteStorySuggestionStatement: Statement = null;

registerDbInitialisedListener(() => {
	addStoryStatement = db.prepare(
		'INSERT INTO story(id, guild_id, owner_id, title, author, teaser, status, last_changed_timestamp) ' +
			"VALUES(:id, :guildId, :ownerId, :title, :author, :teaser, 'Draft', unixepoch())"
	);
	// Even though the id is unique across all guilds, this still validates if the story is for the right guild.
	// Otherwise, with a very small chance, a story in guild A might get deleted, freeing up its id, and a story in guild B gets created with the same UUID.
	getStoryStatement = db.prepare(
		'SELECT id, guild_id, owner_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			'FROM story WHERE id = :storyId AND guild_id = :guildId'
	);
	getStoriesStatement = db.prepare(
		'SELECT id, guild_id, owner_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status != 'Draft' AND status != 'ToBeDeleted' ORDER BY title"
	);
	getPublishedStoriesStatement = db.prepare(
		'SELECT id, guild_id, owner_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND (status = 'Published' OR ((status = 'Testing' OR status = 'Unlisted') AND owner_id = :userId)) ORDER BY title"
	);
	findMatchingStoriesStatement = db.prepare(
		'SELECT id, guild_id, owner_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND status != 'Draft' AND status != 'ToBeDeleted' AND title LIKE :pattern ESCAPE '#' ORDER BY title"
	);
	findMatchingPublishedStoriesStatement = db.prepare(
		'SELECT id, guild_id, owner_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			"FROM story WHERE guild_id = :guildId AND (status = 'Published' OR ((status = 'Testing' OR status = 'Unlisted') AND owner_id = :userId)) AND title LIKE :pattern ESCAPE '#' ORDER BY title"
	);
	countStoriesStatement = db
		.prepare("SELECT count(id) FROM story WHERE guild_id = :guildId AND status != 'Draft' AND status != 'ToBeDeleted'")
		.pluck();
	countAllStoriesStatement = db.prepare('SELECT count(id) FROM story WHERE guild_id = :guildId').pluck();
	changeStoryMetadataStatement = db.prepare(
		'UPDATE story SET title = :title, author = :author, teaser = :teaser, last_changed_timestamp = unixepoch() WHERE id = :storyId AND guild_id = :guildId'
	);
	// Changing the story owner clears all reporting flags (but not the counter, since that could be abused).
	// Since someone else is now responsible for warnings about this story, they might not have seen existing ones before.
	changeStoryOwnerStatement = db.prepare(
		'UPDATE story SET owner_id = :ownerId, last_changed_timestamp = unixepoch(), reported_ink_error = 0, reported_ink_warning = 0, ' +
			'reported_maximum_choice_number_exceeded = 0, reported_potential_loop_detected = 0 WHERE id = :storyId AND guild_id = :guildId'
	);
	changeStoryStatusStatement = db.prepare(
		'UPDATE story SET status = :status, last_changed_timestamp = unixepoch() WHERE id = :storyId AND guild_id = :guildId'
	);
	changeStoryStatusConditionallyStatement = db.prepare(
		'UPDATE story SET status = :status, last_changed_timestamp = unixepoch() WHERE id = :storyId AND guild_id = :guildId AND status = :previousExpectedStatus'
	);
	deleteStoryStatement = db.prepare('DELETE FROM story WHERE id = :storyId AND guild_id = :guildId');
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
	deleteObsoleteStoriesStatement = db.prepare(
		"DELETE FROM story WHERE status == 'Draft' OR status == 'ToBeDeleted' AND :secondsSinceEpoch - last_changed_timestamp > 60 * 60 * 24"
	);
	getStoriesToDeleteForObsoleteGuildsStatement = db
		.prepare('SELECT s.id FROM story s WHERE s.guild_id IN (' + obsoleteGuildsSelect + ')')
		.pluck();
	deleteStoriesForObsoleteGuildsStatement = db.prepare(
		'DELETE FROM story AS s WHERE s.guild_id IN (' + obsoleteGuildsSelect + ')'
	);
	getStoryPlayStatement = db.prepare(
		'SELECT id, guild_id, owner_id, title, author, teaser, status, last_changed_timestamp, ' +
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
	addOrEditStorySuggestionStatement = db.prepare(
		'INSERT INTO story_suggestion(source_story_id, target_story_id, message) VALUES(:sourceStoryId, :targetStoryId, :message)' +
			' ON CONFLICT(source_story_id, target_story_id) DO UPDATE SET message = :message'
	);
	getStorySuggestionStatement = db.prepare(
		'SELECT message FROM story_suggestion WHERE source_story_id = :sourceStoryId AND target_story_id = :targetStoryId'
	);
	getSuggestedStoriesStatement = db.prepare(
		'SELECT id, guild_id, owner_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count ' +
			'FROM story s JOIN story_suggestion g ON s.id = g.target_story_id WHERE g.source_story_id = :storyId'
	);
	getStorySuggestionsStatement = db.prepare(
		'SELECT id, guild_id, owner_id, title, author, teaser, status, last_changed_timestamp, ' +
			'reported_ink_error, reported_ink_warning, reported_maximum_choice_number_exceeded, reported_potential_loop_detected, time_budget_exceeded_count, message ' +
			'FROM story s JOIN story_suggestion g ON s.id = g.target_story_id WHERE g.source_story_id = :storyId'
	);
	deleteStorySuggestionStatement = db.prepare(
		'DELETE FROM story_suggestion WHERE source_story_id = :sourceStoryId AND target_story_id = :targetStoryId'
	);
});

export async function addStory(
	storyContent: string,
	{ title = '', author = '', teaser = '' }: StoryMetadata,
	ownerId: string,
	guildId: string
) {
	// If this fails, we don't need to execute the rest.
	ensureGuildConfigurationExists(guildId);

	if (title === '') {
		title = null;
	}

	let id: string;
	let inserted = false;
	let attempts = 0;
	while (!inserted && attempts < 10) {
		id = uuidv4();
		try {
			addStoryStatement.run({ id, guildId, ownerId, title, author, teaser });
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
export function getStory(storyId: string, guildId: string): StoryRecord | null {
	const row = getStoryStatement.get({ storyId, guildId });
	if (row) {
		return new StoryRecord(row);
	}
	return null;
}

export function getStories(guildId: string, userId: string, publishedOrByUserOnly: boolean) {
	let statement: Statement;
	if (publishedOrByUserOnly) {
		statement = getPublishedStoriesStatement;
	} else {
		statement = getStoriesStatement;
	}
	return statement.all({ guildId, userId }).map(row => new StoryRecord(row));
}

export function findMatchingStories(
	guildId: string,
	userId: string,
	searchInput: string,
	logger: Logger,
	publishedOrByUserOnly: boolean
) {
	try {
		const pattern = escapeSearchInputToLikePattern(searchInput);
		let statement: Statement;
		if (publishedOrByUserOnly) {
			statement = findMatchingPublishedStoriesStatement;
		} else {
			statement = findMatchingStoriesStatement;
		}
		return statement.all({ guildId, userId, pattern }).map(row => new StoryRecord(row));
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

/**
 * Counts the number of stories that exist in a guild.
 * @param guildId The id of the guild to search.
 * @param all Whether all stories should be counted or only those that are not in status Draft or ToBeDeleted.
 * @returns The number of stories that exist. 0 if there are none or if an error occurred during the database fetching.
 */
export function getNumberOfStories(guildId: string, logger: Logger, all?: boolean) {
	try {
		let result: number;
		if (all) {
			result = countAllStoriesStatement.get({ guildId });
		} else {
			result = countStoriesStatement.get({ guildId });
		}
		return result ?? 0;
	} catch (error) {
		logger.error(error, 'Error while trying to count stories in guild %', guildId);
		return 0;
	}
}

export async function replaceStoryContent(storyId: string, storyContent: string) {
	await writeStoryFile(storyId, storyContent);
	clearWarningFlagsAndCounters(storyId);
}

async function writeStoryFile(storyId: string, storyContent: string) {
	await fsPromises.writeFile(getStoryFilePath(storyId), storyContent);
}

async function deleteStoryFile(storyId: string) {
	await fsPromises.rm(getStoryFilePath(storyId));
}

function getStoryFilePath(storyId: string) {
	return storyFilesDir + path.sep + storyId + '.json';
}

export async function loadStoryContent(storyId: string) {
	return await fsPromises.readFile(getStoryFilePath(storyId), 'utf-8');
}

export function changeStoryMetadata(storyId: string, guildId: string, { author = '', teaser = '' }) {
	const info = changeStoryMetadataStatement.run({ title: null, author, teaser, storyId, guildId });
	return info.changes > 0;
}

export function completeStoryMetadata(
	storyId: string,
	guildId: string,
	{ title, author = '', teaser = '' }: StoryMetadata
) {
	return db.transaction(() => {
		const info = changeStoryMetadataStatement.run({ title, author, teaser, storyId, guildId });
		if (info.changes > 0) {
			moveStoryToTesting(storyId, guildId);
			return true;
		}
		return false;
	})();
}

export function changeStoryOwner(storyId: string, guildId: string, ownerId: string) {
	const info = changeStoryOwnerStatement.run({ ownerId, storyId, guildId });
	return info.changes > 0;
}

export function moveStoryToTesting(storyId: string, guildId: string) {
	return setStoryStatus(storyId, guildId, StoryStatus.Testing, StoryStatus.Draft);
}

export function publishStory(storyId: string, guildId: string) {
	return setStoryStatus(storyId, guildId, StoryStatus.Published);
}

export function publishStoryUnlisted(storyId: string, guildId: string) {
	return setStoryStatus(storyId, guildId, StoryStatus.Unlisted);
}

/**
 * Marks a story for automatic deletion at a later point (by setting its status to ToBeDeleted).
 * The story will not appear in any lists or searches anymore.
 * Also clears current plays for everyone playing the story.
 */
export function markStoryForDeletion(storyId: string, guildId: string) {
	return db.transaction(() => {
		const story = getStory(storyId, guildId);
		if (story) {
			setStoryStatus(storyId, guildId, StoryStatus.ToBeDeleted);
			clearCurrentStoryPlays(storyId);
			return true;
		}
		return false;
	})();
}

export function setStoryStatus(
	storyId: string,
	guildId: string,
	status: StoryStatus,
	previousExpectedStatus?: StoryStatus
) {
	let info: Database.RunResult;
	if (previousExpectedStatus) {
		info = changeStoryStatusConditionallyStatement.run({ status, storyId, guildId, previousExpectedStatus });
	} else {
		info = changeStoryStatusStatement.run({ status, storyId, guildId });
	}
	return info.changes > 0;
}

export function deleteStory(storyId: string, guildId: string) {
	const info = deleteStoryStatement.run({ storyId, guildId });
	return info.changes > 0;
}

export function markIssueAsReported(storyId: string, ownerReportType: OwnerReportType) {
	let info: Database.RunResult | null = null;
	switch (ownerReportType) {
		case OwnerReportType.InkError:
			info = markInkErrorAsReported.run({ storyId });
			break;
		case OwnerReportType.InkWarning:
			info = markInkWarningAsReported.run({ storyId });
			break;
		case OwnerReportType.MaximumChoiceNumberExceeded:
			info = markMaximumChoiceNumberExceededAsReported.run({ storyId });
			break;
		case OwnerReportType.PotentialLoopDetected:
			info = markPotentialLoopDetectedAsReported.run({ storyId });
			break;
		default:
			throw new Error('Unknown owner report type: ' + ownerReportType);
	}
	return info?.changes > 0;
}

export function increaseTimeBudgetExceededCounter(storyId: string) {
	const info = increaseTimeBudgetExceededCounterStatement.run({ storyId });
	return info.changes > 0;
}

function clearWarningFlagsAndCounters(storyId: string) {
	const info = clearWarningFlagsAndCountersStatement.run({ storyId });
	return info.changes > 0;
}

export async function cleanupStories(forObsoleteGuilds: boolean, logger: Logger) {
	const getStatement = forObsoleteGuilds ? getStoriesToDeleteForObsoleteGuildsStatement : getStoriesToDeleteStatement;
	const deleteStatement = forObsoleteGuilds ? deleteStoriesForObsoleteGuildsStatement : deleteObsoleteStoriesStatement;

	const storyIds = db.transaction(() => {
		const secondsSinceEpoch = Math.floor(Date.now() / 1000);
		const storiesToDelete = getStatement.all({ secondsSinceEpoch });
		const info = deleteStatement.run({ secondsSinceEpoch });
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

export function getCurrentStoryPlay(userId: string): StoryPlay {
	const row = getStoryPlayStatement.get({ userId });
	if (row) {
		return {
			storyRecord: new StoryRecord(row),
			storyState: row.state_json
		};
	}
	return null;
}

export function hasCurrentStoryPlay(userId: string) {
	return !!hasStoryPlayStatement.get({ userId });
}

export function saveCurrentStoryPlay(userId: string, storyId: string) {
	addStoryPlayStatement.run({ userId, storyId });
}

export function clearCurrentStoryPlay(userId: string) {
	const info = clearStoryPlayStatement.run({ userId });
	return info.changes > 0;
}

function clearCurrentStoryPlays(storyId: string) {
	clearStoryPlaysStatement.run({ storyId });
}

export function saveStoryPlayState(userId: string, stateJson: string) {
	saveStoryPlayStateStatement.run({ userId, stateJson });
}

export function resetStoryPlayState(userId: string) {
	resetStoryPlayStateStatement.run({ userId });
}

export function getCurrentPlayers(storyId: string): string[] {
	return getCurrentPlayersStatement.all({ storyId });
}

// TODO later: methods for saving, querying and clearing past plays

export function addOrEditStorySuggestion(
	sourceStoryId: string,
	targetStoryId: string,
	guildId: string,
	message: string
) {
	// Ensure both stories exist in the provided guild.
	const sourceStory = getStory(sourceStoryId, guildId);
	const targetStory = getStory(targetStoryId, guildId);
	if (sourceStory && targetStory) {
		addOrEditStorySuggestionStatement.run({ sourceStoryId, targetStoryId, message });
	} else {
		throw new Error('Stories are not in the provided guild.');
	}
}

export function getStorySuggestion(sourceStoryId: string, targetStoryId: string): StorySuggestion | null {
	const row = getStorySuggestionStatement.get({ sourceStoryId, targetStoryId });
	if (row) {
		return {
			sourceStoryId: row.source_story_id,
			targetStoryId: row.target_story_id,
			message: row.message
		};
	}
	return null;
}

export function getSuggestedStories(storyId: string): StoryRecord[] {
	return getSuggestedStoriesStatement.all({ storyId }).map(row => new StoryRecord(row));
}

export function getStorySuggestions(storyId: string): SuggestionData[] {
	return getStorySuggestionsStatement
		.all({ storyId })
		.map(row => ({ suggestedStory: new StoryRecord(row), message: row.message }));
}

export function deleteStorySuggestion(sourceStoryId: string, targetStoryId: string) {
	const info = deleteStorySuggestionStatement.run({ sourceStoryId, targetStoryId });
	return info.changes;
}
