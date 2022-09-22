/**
 * Contains methods dealing with running a story.
 *
 * Does not concern itself with how to send the story state to the user but it does deal with reporting problems in the story to the story editor via DMs.
 */

import inkjs from 'inkjs';
import { ErrorType } from 'inkjs/engine/Error.js';
import { Constants, MessageEmbed } from 'discord.js';
import { quote } from '@discordjs/builders';
import { parseCharacters, parseMetadata } from './story-information-extractor.js';
import {
	getStory,
	loadStoryContent,
	getCurrentStoryPlay,
	hasCurrentStoryPlay,
	saveCurrentStoryPlay,
	clearCurrentStoryPlay,
	saveStoryPlayState,
	resetStoryPlayState,
	EditorReportType,
	markIssueAsReported,
	increaseTimeBudgetExceededCounter,
	getCurrentPlayers
} from '../storage/story-dao.js';
import { getGuildConfig } from '../storage/guild-config-dao.js';
import {
	MESSAGE_ACTION_ROW_LIMIT,
	ACTION_ROW_BUTTON_LIMIT,
	EMBED_DESCRIPTION_CHARACTER_LIMIT,
	COLOUR_DISCORD_YELLOW
} from '../util/discord-constants.js';
import { translate } from '../util/i18n.js';
import { splitTextAtWhitespace } from '../util/helpers.js';

// TODO write tests

export const StoryErrorType = Object.freeze({
	StoryNotFound: 'StoryNotFound',
	AlreadyPlayingDifferentStory: 'AlreadyPlayingDifferentStory',
	StoryNotStartable: 'StoryNotStartable',
	NoStoryRunning: 'NoStoryRunning',
	StoryNotContinueable: 'StoryNotContinueable',
	TemporaryProblem: 'TemporaryProblem',
	InvalidChoice: 'InvalidChoice',
	CouldNotSaveState: 'CouldNotSaveState',
	TimeBudgetExceeded: 'TimeBudgetExceeded'
});

/**
 * Time that the calculation of the next story content is allowed to take before it will be interrupted to prevent loops.
 * We don't want to make the budget too large because it can affect other requests to the bot lagging behind.
 * We also don't want to make it too small or we might exceed it even though the story doesn't loop, just because the server was too busy with other stuff
 * (although the JavaScript thread shouldn't yield during time measurement at least).
 */
const TIME_BUDGET_IN_MS = 300;

/**
 * Number of times that the time budget can be exceeded for a story before a potential loop problem is reported to the editor.
 */
const POTENTIAL_LOOP_THRESHOLD = 10;

/**
 * Maximum number of lines to include in a report to the editor of a story.
 * These are taken from the end of the last calculated lines.
 */
const MAX_LAST_LINES_TO_REPORT = 5;

function newError(storyErrorType) {
	const error = new Error();
	error.storyErrorType = storyErrorType;
	return error;
}

async function loadStory(storyId) {
	const storyContent = await loadStoryContent(storyId);
	try {
		return new inkjs.Story(storyContent);
	} catch (error) {
		error.type = 'story-error';
		throw error;
	}
}

export async function startStory(userId, storyId, guildId, client, logger) {
	let hasCurrentStory;
	try {
		hasCurrentStory = hasCurrentStoryPlay(userId);
	} catch (error) {
		logger.error(error, 'Error while trying to check if user %s has current story play', userId);
		throw newError(StoryErrorType.StoryNotStartable);
	}
	if (hasCurrentStory) {
		throw newError(StoryErrorType.AlreadyPlayingDifferentStory);
	}

	let inkStory;
	let storyRecord;
	try {
		storyRecord = getStory(storyId, guildId);
	} catch (error) {
		logger.error(error, 'Error while trying to find story %s in database', storyId);
		throw newError(StoryErrorType.StoryNotStartable);
	}
	if (storyRecord !== null) {
		try {
			inkStory = await loadStory(storyRecord.id);
		} catch (error) {
			if (error.type === 'story-error') {
				// Usually this should've been captured when the user tried to upload the file and the file would've been rejected.
				// But theoretically it could happen when a story was already created, we update the Ink engine and the story file becomes incompatible.
				const issueDetails = error.message;
				informStoryEditor(client, storyRecord, EditorReportType.InkError, issueDetails, [], logger);
			} else {
				logger.error(error, 'Error while trying to load story %s.', storyId);
			}
			throw newError(StoryErrorType.StoryNotStartable);
		}
		try {
			saveCurrentStoryPlay(userId, storyId);
		} catch (error) {
			logger.error(error, 'Error while trying to save current story for user %s in database', userId);
			throw newError(StoryErrorType.StoryNotStartable);
		}
	}

	if (!inkStory) {
		throw newError(StoryErrorType.StoryNotFound);
	}

	// Stories that have had a potential loop detected will not be startable until the problem is fixed.
	// This is to protect the bot from spending too much unnecessary CPU time on the story.
	if (storyRecord.reportedPotentialLoopDetected) {
		throw newError(StoryErrorType.StoryNotStartable);
	}

	let stepData;
	try {
		stepData = storyStep(userId, inkStory, storyRecord, client, logger);
	} catch (error) {
		try {
			clearCurrentStoryPlay(userId);
		} catch (error) {
			logger.error(error, 'Error while trying to clear current story play for user %s in database.', userId);
		}
		throw error;
	}
	stepData.storyRecord = storyRecord;
	stepData.characters = parseCharacters(inkStory);

	return stepData;
}

export async function continueStory(userId, choiceIndex, client, logger) {
	let storyData;

	try {
		storyData = await loadCurrentStory(userId, logger);
	} catch (error) {
		if (error.type === 'story-error') {
			// If it's a story error, we cancelled the story for the user, so we need to tell them.
			// We don't log it since it's not a system error but rather a user error (the user being the uploader).
			// It is very unlikely we end up here since the same error would have happened when trying to start the story already.
			// So we probably don't need to tell the uploader about it.
			throw newError(StoryErrorType.StoryNotContinueable);
		} else {
			// Other errors like database errors and file system errors might be temporary.
			logger.error(error, 'Error while trying to load current story for user %s.', userId);
			throw newError(StoryErrorType.TemporaryProblem);
		}
	}

	if (storyData === null) {
		throw newError(StoryErrorType.StoryNotFound);
	}

	try {
		storyData.inkStory.ChooseChoiceIndex(choiceIndex);
	} catch (e) {
		// Not aborting story here because user might've just clicked an old button.
		// We disable the buttons when the user makes a choice but this can happen when a story gets cancelled e.g.
		throw newError(StoryErrorType.InvalidChoice);
	}

	const stepData = storyStep(userId, storyData.inkStory, storyData.storyRecord, client, logger);
	stepData.storyRecord = storyData.storyRecord;
	stepData.characters = parseCharacters(storyData.inkStory);

	return stepData;
}

async function loadCurrentStory(userId, logger) {
	const currentStoryAndState = getCurrentStoryPlay(userId);
	if (currentStoryAndState === null) {
		return null;
	}

	let inkStory;
	try {
		inkStory = await loadStory(currentStoryAndState.storyRecord.id);
	} catch (error) {
		// Usually this should've been captured when the user tried to upload the file and the file would've been rejected.
		// But theoretically it could happen when a story was already created, we update the Ink engine and the story file becomes incompatible.
		if (error.type === 'story-error') {
			// Other errors might only be temporary and so we don't want to clear the current story play for those.
			// But story errors usually prevent the user from continuing the story.
			try {
				clearCurrentStoryPlay(userId);
			} catch (error) {
				logger.error(error, 'Story state could not be cleared in database for user %s.', userId);
			}
		}
		throw error;
	}

	if (currentStoryAndState.storyState !== null) {
		try {
			inkStory.state.LoadJson(currentStoryAndState.storyState);
		} catch (error) {
			error.type = 'story-error';
			try {
				clearCurrentStoryPlay(userId);
			} catch (error) {
				logger.error(error, 'Story state could not be cleared in database for user %s.', userId);
			}
			throw error;
		}
	}

	return { inkStory, storyRecord: currentStoryAndState.storyRecord };
}

function storyStep(userId, inkStory, storyRecord, client, logger) {
	let stepData;
	let hadException = false;
	try {
		stepData = runStoryStep(inkStory);
	} catch (error) {
		logger.error(
			error,
			'Error caught in running story step that is not a StoryException. Story id: %s',
			storyRecord.id
		);
		hadException = true;
	}

	// This will be set on the story when continuing it took too long.
	if (!hadException && !inkStory.asyncContinueComplete) {
		const loopDetected = detectPotentialLoop(storyRecord, client, stepData.lines, logger);
		if (loopDetected) {
			// We handle this like a story error, stopping the story for the user and informing them that it's stopped.
			hadException = true;
		} else {
			// Otherwise we just inform the user about this particular error.
			throw newError(StoryErrorType.TimeBudgetExceeded);
		}
	}

	if (hadException || stepData.errors) {
		if (stepData?.errors?.length) {
			const issueDetails = stepData.errors.join('\n');
			informStoryEditor(client, storyRecord, EditorReportType.InkError, issueDetails, stepData.lines, logger);
		}

		try {
			clearCurrentStoryPlay(userId);
		} catch (error) {
			logger.error(error, 'Story state could not be cleared in database for user %s.', userId);
		}

		throw newError(StoryErrorType.StoryNotContinueable);
	}

	if (stepData.warnings.length) {
		// No need to log these or tell user. Story can continue as normal. Only tell the editor.
		const issueDetails = stepData.warnings.join('\n');
		informStoryEditor(client, storyRecord, EditorReportType.InkWarning, issueDetails, stepData.lines, logger);
	}

	if (stepData.choices.length > ACTION_ROW_BUTTON_LIMIT * MESSAGE_ACTION_ROW_LIMIT) {
		// List the current choices that could be available to the user in the report to the editor
		// to help them identify the problematic part in the story.
		const issueDetails = stepData.choices.map(choice => choice.text).join('\n');
		informStoryEditor(
			client,
			storyRecord,
			EditorReportType.MaximumChoiceNumberExceeded,
			issueDetails,
			stepData.lines,
			logger
		);
	}

	try {
		const stateJson = inkStory.state.ToJson();
		saveStoryPlayState(userId, stateJson);
	} catch (error) {
		logger.error(error, 'Error trying to save story play state for user %s', userId);
		throw newError(StoryErrorType.CouldNotSaveState);
	}

	if (stepData.choices.length === 0) {
		endStory(userId, logger);
		stepData.isEnd = true;
	}

	return stepData;
}

function runStoryStep(inkStory) {
	const lines = [];
	const warnings = [];
	const errors = [];
	inkStory.onError = (message, errorType) => {
		if (errorType === ErrorType.Error) {
			errors.push(message);
		} else if (errorType === ErrorType.Warning) {
			warnings.push(message);
		}
	};

	while (inkStory.canContinue) {
		// We use a time boxed call to get the next story content so that we can guarantee that we will not get stuck in the call.
		// This is to prevent loops in a story (whether submitted by a malicious user or by mistake) from locking the bot.
		inkStory.ContinueAsync(TIME_BUDGET_IN_MS);
		// Will be set if ContinueAsync took longer than TIME_BUDGET_IN_MS and couldn't finish calculating the next story content.
		if (!inkStory.asyncContinueComplete) {
			break;
		}
		const text = inkStory.currentText;
		const tags = inkStory.currentTags;
		lines.push({
			text,
			tags
		});

		if (errors.length) {
			return {
				lines,
				choices: [],
				warnings,
				errors
			};
		}
	}

	return {
		lines,
		choices: inkStory.currentChoices,
		warnings
	};
}

function detectPotentialLoop(storyRecord, client, lines, logger) {
	try {
		increaseTimeBudgetExceededCounter(storyRecord.id);
		// Add 1 here because we don't have the updated object from the db.
		if (storyRecord.timeBudgetExceededCount + 1 > POTENTIAL_LOOP_THRESHOLD) {
			informStoryEditor(client, storyRecord, EditorReportType.PotentialLoopDetected, '', lines, logger);
			return true;
		}
	} catch (error) {
		logger.error(error, 'Error while trying to detect potential loop in story %s.', storyRecord.id);
	}
	return false;
}

export async function restartStory(userId, client, logger) {
	try {
		resetStoryPlayState(userId);
	} catch (error) {
		logger.error(error, 'Error while trying to reset current story play state for user %s in database.', userId);
		throw newError(StoryErrorType.CouldNotSaveState);
	}

	let storyData;

	try {
		storyData = await loadCurrentStory(userId, logger);
	} catch (error) {
		if (error.type === 'story-error') {
			throw newError(StoryErrorType.StoryNotContinueable);
		} else {
			logger.error(error, 'Error while trying to load current story for user %s.', userId);
			throw newError(StoryErrorType.TemporaryProblem);
		}
	}

	if (storyData === null) {
		throw newError(StoryErrorType.StoryNotFound);
	}

	const stepData = storyStep(userId, storyData.inkStory, storyData.storyRecord, client, logger);
	stepData.storyRecord = storyData.storyRecord;
	stepData.characters = parseCharacters(storyData.inkStory);

	return stepData;
}

export async function getCurrentStoryState(userId, logger) {
	let storyData;
	try {
		storyData = await loadCurrentStory(userId, logger);
	} catch (error) {
		if (error.type === 'story-error') {
			throw newError(StoryErrorType.StoryNotContinueable);
		} else {
			logger.error(error, 'Error while trying to load current story for user %s.', userId);
			throw newError(StoryErrorType.TemporaryProblem);
		}
	}

	if (storyData === null) {
		throw newError(StoryErrorType.StoryNotFound);
	}

	if (storyData.inkStory.hasError) {
		// Since this is a repeat of a previous state, these errors should already have been reported to the author so we don't need to do that here.
		// We also don't care about warnings for the same reason.
		throw newError(StoryErrorType.StoryNotContinueable);
	}

	const lines = [];
	const tags = storyData.inkStory.currentTags;
	lines.push({
		text: storyData.inkStory.currentText,
		tags
	});

	const stepData = {
		lines,
		choices: storyData.inkStory.currentChoices,
		storyRecord: storyData.storyRecord
	};
	stepData.characters = parseCharacters(storyData.inkStory);
	return stepData;
}

function endStory(userId, logger) {
	try {
		clearCurrentStoryPlay(userId);
	} catch (error) {
		logger.error(error, 'Story state could not be cleared in database for user %s.', userId);
	}
	// TODO save story as finished. also check which ending we got (how does the story signal that? can we query the current knot? maybe the state of a specific variable?) and store that.
	//  if the user was the editor if the story or the story was in testing, don't record it as played? depends what I want to do with that information.
}

export function probeStory(storyContent) {
	const inkStory = new inkjs.Story(storyContent);
	const stepData = runStoryStep(inkStory);
	if (!inkStory.asyncContinueComplete) {
		throw newError(StoryErrorType.TimeBudgetExceeded);
	}
	stepData.metadata = parseMetadata(inkStory);
	return stepData;
}

function informStoryEditor(client, storyRecord, reportType, issueDetails, lastLines, logger) {
	informStoryEditorAsync(client, storyRecord, reportType, issueDetails, lastLines, logger).catch(error =>
		// This should be a fire-and-forget action for the caller
		// (so that the reporting doesn't interfere with playing the story)
		// so we just log it and don't throw it further up the chain.
		logger.error(
			error,
			'Error while trying to inform story editor %s about story issues. Story id: %s',
			storyRecord.editorId,
			storyRecord.id
		)
	);
}

async function informStoryEditorAsync(client, storyRecord, reportType, issueDetails, lastLines, logger) {
	if (!storyRecord.hasIssueBeenReported(reportType)) {
		const guild = await client.guilds.fetch(storyRecord.guildId);
		// Make sure the bot is still in this guild.
		if (guild) {
			const guildMember = await guild.members.fetch(storyRecord.editorId);
			// Make sure the user is still in the guild.
			if (guildMember) {
				// Sadly we don't get access to the member's locale outside of interactions (probably for privacy reasons).
				// And we have no interaction with this user. So the best we can do is use the guild's locale.
				const guildConfig = getGuildConfig(storyRecord.guildId, logger);
				const locale = guildConfig.language ?? guild.preferredLocale ?? 'en';

				let message = translate('commands.story.editor-report.intro', {
					storyTitle: storyRecord.title,
					serverName: guild.name,
					lng: locale
				});
				message +=
					'\n' +
					translate('commands.story.editor-report.type-' + reportType, {
						// This replacement is only relevant for one of the messages.
						choiceLimit: ACTION_ROW_BUTTON_LIMIT * MESSAGE_ACTION_ROW_LIMIT,
						lng: locale
					});
				if (issueDetails) {
					message +=
						'\n' +
						issueDetails
							.split('\n')
							.map(line => quote(line))
							.join('\n');
				}
				if (lastLines?.length) {
					message +=
						'\n' +
						translate('commands.story.editor-report.last-lines', { lng: locale }) +
						'\n' +
						lastLines
							// Only include the last MAX_LAST_LINES_TO_REPORT lines in the report.
							.slice(-MAX_LAST_LINES_TO_REPORT)
							.map(line => quote(line.text))
							.join('');
				}
				message += '\n' + translate('commands.story.editor-report.no-repeat', { lng: locale });

				// This *might* split up a quoted line but it's probably unlikely enough that it doesn't matter, it just looks a bit ugly/confusing then.
				const messages = splitTextAtWhitespace(message, EMBED_DESCRIPTION_CHARACTER_LIMIT);
				const dmChannel = await guildMember.createDM();
				await Promise.all(
					messages.map(msg =>
						dmChannel.send({
							embeds: [new MessageEmbed().setDescription(msg).setColor(COLOUR_DISCORD_YELLOW)]
						})
					)
				);

				markIssueAsReported(storyRecord.id, reportType);
			}
		}
	}
}

export async function stopStoryPlayAndInformPlayers(storyRecord, client, getStartStoryButtonId, logger) {
	try {
		const guild = await client.guilds.fetch(storyRecord.guildId);
		// Make sure the bot is still in this guild.
		if (guild) {
			const guildConfig = getGuildConfig(storyRecord.guildId, logger);
			const locale = guildConfig.language ?? guild.preferredLocale ?? 'en';
			const currentPlayers = getCurrentPlayers(storyRecord.id);
			await Promise.allSettled(
				currentPlayers.map(userId => {
					return stopStoryPlayAndInformPlayer(userId, storyRecord, guild, locale, getStartStoryButtonId).catch(
						error => {
							logger.error(
								error,
								'Error while trying to inform player %s about story play state being reset. Story id: %s',
								userId,
								storyRecord.id
							);
						}
					);
				})
			);
		}
	} catch (error) {
		logger.error(
			error,
			'Error while trying to inform players about story state being reset. Story id: %s',
			storyRecord.id
		);
	}
}

async function stopStoryPlayAndInformPlayer(userId, storyRecord, guild, locale, getStartStoryButtonId) {
	clearCurrentStoryPlay(userId);

	const guildMember = await guild.members.fetch(userId);
	// Make sure the user is still in the guild.
	if (guildMember) {
		const dmChannel = await guildMember.createDM();
		await dmChannel.send({
			embeds: [
				new MessageEmbed()
					.setDescription(
						translate('commands.config-story.story-updated-and-stopped-notification', {
							storyTitle: storyRecord.title,
							serverName: guild.name,
							lng: locale
						})
					)
					.setColor(COLOUR_DISCORD_YELLOW)
			],
			components: [
				{
					type: Constants.MessageComponentTypes.ACTION_ROW,
					components: [
						{
							type: Constants.MessageComponentTypes.BUTTON,
							style: Constants.MessageButtonStyles.SUCCESS,
							label: translate('commands.config-story.restart-button-label', {
								lng: locale
							}),
							custom_id: getStartStoryButtonId(storyRecord.id, guild.id)
						}
					]
				}
			]
		});
	}
}
