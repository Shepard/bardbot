/**
 * Contains methods dealing with running a story.
 *
 * Does not concern itself with how to send the story state to the user but it does deal with reporting problems in the story to the story owner via DMs.
 */

import { Story } from '@shepard4711/inkjs/engine/Story.js';
import { ErrorType } from '@shepard4711/inkjs/engine/Error.js';
import { ButtonStyle, Client, ComponentType, DiscordAPIError, EmbedBuilder, Guild, quote } from 'discord.js';
import { Logger } from 'pino';
import { FullGuildConfiguration, OwnerReportType, StoryRecord, SuggestionData } from '../storage/record-types.js';
import {
	EnhancedStepData,
	StepData,
	StoryData,
	StoryEngineError,
	StoryErrorType,
	StoryLine,
	StoryProbe
} from './story-types.js';
import { parseCharacters, parseDefaultButtonStyle, parseMetadata } from './story-information-extractor.js';
import {
	getStory,
	loadStoryContent,
	getCurrentStoryPlay,
	hasCurrentStoryPlay,
	saveCurrentStoryPlay,
	clearCurrentStoryPlay,
	saveStoryPlayState,
	resetStoryPlayState,
	markIssueAsReported,
	increaseTimeBudgetExceededCounter,
	getCurrentPlayers,
	getStorySuggestions
} from '../storage/story-dao.js';
import { getGuildConfig } from '../storage/guild-config-dao.js';
import {
	MESSAGE_ACTION_ROW_LIMIT,
	ACTION_ROW_BUTTON_LIMIT,
	EMBED_DESCRIPTION_CHARACTER_LIMIT,
	COLOUR_DISCORD_YELLOW,
	API_ERROR_CODE__OPENING_DMS_TOO_FAST,
	API_ERROR_CODE__CANNOT_SEND_DMS_TO_USER
} from '../util/discord-constants.js';
import { translate } from '../util/i18n.js';
import { splitTextAtWhitespace } from '../util/helpers.js';

/**
 * Time that the calculation of the next story content is allowed to take before it will be interrupted to prevent loops.
 * We don't want to make the budget too large because it can affect other requests to the bot lagging behind.
 * We also don't want to make it too small or we might exceed it even though the story doesn't loop, just because the server was too busy with other stuff
 * (although the JavaScript thread shouldn't yield during time measurement at least).
 */
const TIME_BUDGET_IN_MS = 300;

/**
 * Number of times that the time budget can be exceeded for a story before a potential loop problem is reported to the owner.
 */
const POTENTIAL_LOOP_THRESHOLD = 10;

/**
 * Maximum number of lines to include in a report to the owner of a story.
 * These are taken from the end of the last calculated lines.
 */
const MAX_LAST_LINES_TO_REPORT = 5;

async function loadStory(storyId: string) {
	const storyContent = await loadStoryContent(storyId);
	try {
		return new Story(storyContent);
	} catch (error) {
		error.type = 'story-error';
		throw error;
	}
}

export async function startStory(
	userId: string,
	storyId: string,
	guildId: string,
	client: Client,
	logger: Logger
): Promise<EnhancedStepData> {
	let hasCurrentStory: boolean;
	try {
		hasCurrentStory = hasCurrentStoryPlay(userId);
	} catch (error) {
		logger.error(error, 'Error while trying to check if user %s has current story play', userId);
		throw new StoryEngineError(StoryErrorType.StoryNotStartable);
	}
	if (hasCurrentStory) {
		throw new StoryEngineError(StoryErrorType.AlreadyPlayingDifferentStory);
	}

	let inkStory: Story;
	let storyRecord: StoryRecord;
	try {
		storyRecord = getStory(storyId, guildId);
	} catch (error) {
		logger.error(error, 'Error while trying to find story %s in database', storyId);
		throw new StoryEngineError(StoryErrorType.StoryNotStartable);
	}
	if (storyRecord !== null) {
		try {
			inkStory = await loadStory(storyRecord.id);
		} catch (error) {
			if (error.type === 'story-error') {
				// Usually this should've been captured when the user tried to upload the file and the file would've been rejected.
				// But theoretically it could happen when a story was already created, we update the Ink engine and the story file becomes incompatible.
				const issueDetails = error.message;
				informStoryOwner(client, storyRecord, OwnerReportType.InkError, issueDetails, [], logger);
			} else {
				logger.error(error, 'Error while trying to load story %s.', storyId);
			}
			throw new StoryEngineError(StoryErrorType.StoryNotStartable);
		}
		try {
			saveCurrentStoryPlay(userId, storyId);
		} catch (error) {
			logger.error(error, 'Error while trying to save current story for user %s in database', userId);
			throw new StoryEngineError(StoryErrorType.StoryNotStartable);
		}
	}

	if (!inkStory) {
		throw new StoryEngineError(StoryErrorType.StoryNotFound);
	}

	// Stories that have had a potential loop detected will not be startable until the problem is fixed.
	// This is to protect the bot from spending too much unnecessary CPU time on the story.
	if (storyRecord.reportedPotentialLoopDetected) {
		throw new StoryEngineError(StoryErrorType.StoryNotStartable);
	}

	let stepData: StepData;
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

	return {
		...stepData,
		storyRecord: storyRecord,
		characters: parseCharacters(inkStory),
		defaultButtonStyle: parseDefaultButtonStyle(inkStory)
	};
}

export async function continueStory(
	userId: string,
	choiceIndex: number,
	variableBindings: string[][],
	client: Client,
	logger: Logger
): Promise<EnhancedStepData> {
	let storyData: StoryData;

	try {
		storyData = await loadCurrentStory(userId, logger);
	} catch (error) {
		if (error.type === 'story-error') {
			// If it's a story error, we cancelled the story for the user, so we need to tell them.
			// We don't log it since it's not a system error but rather a user error (the user being the uploader).
			// It is very unlikely we end up here since the same error would have happened when trying to start the story already.
			// So we probably don't need to tell the uploader about it.
			throw new StoryEngineError(StoryErrorType.StoryNotContinueable);
		} else {
			// Other errors like database errors and file system errors might be temporary.
			logger.error(error, 'Error while trying to load current story for user %s.', userId);
			throw new StoryEngineError(StoryErrorType.TemporaryProblem);
		}
	}

	if (storyData === null) {
		throw new StoryEngineError(StoryErrorType.StoryNotFound);
	}

	try {
		if (variableBindings.length) {
			for (const variableBinding of variableBindings) {
				storyData.inkStory.variablesState[variableBinding[0]] = variableBinding[1];
			}
		}

		storyData.inkStory.ChooseChoiceIndex(choiceIndex);
	} catch (e) {
		// Not aborting story here because user might've just clicked an old button.
		// We disable the buttons when the user makes a choice but this can happen when a story gets cancelled e.g.
		throw new StoryEngineError(StoryErrorType.InvalidChoice);
	}

	const stepData = storyStep(userId, storyData.inkStory, storyData.storyRecord, client, logger);
	return {
		...stepData,
		storyRecord: storyData.storyRecord,
		characters: parseCharacters(storyData.inkStory),
		defaultButtonStyle: parseDefaultButtonStyle(storyData.inkStory)
	};
}

async function loadCurrentStory(userId: string, logger: Logger): Promise<StoryData> {
	const currentStoryAndState = getCurrentStoryPlay(userId);
	if (currentStoryAndState === null) {
		return null;
	}

	let inkStory: Story;
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

function storyStep(userId: string, inkStory: Story, storyRecord: StoryRecord, client: Client, logger: Logger) {
	let stepData: StepData;
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
			throw new StoryEngineError(StoryErrorType.TimeBudgetExceeded);
		}
	}

	if (hadException || stepData.errors) {
		if (stepData?.errors?.length) {
			const issueDetails = stepData.errors.join('\n');
			informStoryOwner(client, storyRecord, OwnerReportType.InkError, issueDetails, stepData.lines, logger);
		}

		try {
			clearCurrentStoryPlay(userId);
		} catch (error) {
			logger.error(error, 'Story state could not be cleared in database for user %s.', userId);
		}

		throw new StoryEngineError(StoryErrorType.StoryNotContinueable);
	}

	if (stepData.warnings.length) {
		// No need to log these or tell user. Story can continue as normal. Only tell the owner.
		const issueDetails = stepData.warnings.join('\n');
		informStoryOwner(client, storyRecord, OwnerReportType.InkWarning, issueDetails, stepData.lines, logger);
	}

	if (stepData.choices.length > ACTION_ROW_BUTTON_LIMIT * MESSAGE_ACTION_ROW_LIMIT) {
		// List the current choices that could be available to the user in the report to the owner
		// to help them identify the problematic part in the story.
		const issueDetails = stepData.choices.map(choice => choice.text).join('\n');
		informStoryOwner(
			client,
			storyRecord,
			OwnerReportType.MaximumChoiceNumberExceeded,
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
		throw new StoryEngineError(StoryErrorType.CouldNotSaveState);
	}

	if (stepData.choices.length === 0) {
		endStory(userId, logger);
		stepData.isEnd = true;

		stepData.suggestions = fetchSuggestions(storyRecord.id, logger);
	}

	return stepData;
}

function runStoryStep(inkStory: Story): StepData {
	const lines: StoryLine[] = [];
	const warnings: string[] = [];
	const errors: string[] = [];
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

function detectPotentialLoop(storyRecord: StoryRecord, client: Client, lines: StoryLine[], logger: Logger) {
	try {
		increaseTimeBudgetExceededCounter(storyRecord.id);
		// Add 1 here because we don't have the updated object from the db.
		if (storyRecord.timeBudgetExceededCount + 1 > POTENTIAL_LOOP_THRESHOLD) {
			informStoryOwner(client, storyRecord, OwnerReportType.PotentialLoopDetected, '', lines, logger);
			return true;
		}
	} catch (error) {
		logger.error(error, 'Error while trying to detect potential loop in story %s.', storyRecord.id);
	}
	return false;
}

function fetchSuggestions(storyId: string, logger: Logger): SuggestionData[] {
	try {
		return getStorySuggestions(storyId);
	} catch (error) {
		logger.error(error, 'Error while trying to fetch suggestions for story %s. Ignoring.', storyId);
		return [];
	}
}

export async function restartStory(userId: string, client: Client, logger: Logger): Promise<EnhancedStepData> {
	try {
		resetStoryPlayState(userId);
	} catch (error) {
		logger.error(error, 'Error while trying to reset current story play state for user %s in database.', userId);
		throw new StoryEngineError(StoryErrorType.CouldNotSaveState);
	}

	let storyData: StoryData;

	try {
		storyData = await loadCurrentStory(userId, logger);
	} catch (error) {
		if (error.type === 'story-error') {
			throw new StoryEngineError(StoryErrorType.StoryNotContinueable);
		} else {
			logger.error(error, 'Error while trying to load current story for user %s.', userId);
			throw new StoryEngineError(StoryErrorType.TemporaryProblem);
		}
	}

	if (storyData === null) {
		throw new StoryEngineError(StoryErrorType.StoryNotFound);
	}

	const stepData = storyStep(userId, storyData.inkStory, storyData.storyRecord, client, logger);
	return {
		...stepData,
		storyRecord: storyData.storyRecord,
		characters: parseCharacters(storyData.inkStory),
		defaultButtonStyle: parseDefaultButtonStyle(storyData.inkStory)
	};
}

export async function getCurrentStoryState(userId: string, logger: Logger): Promise<EnhancedStepData> {
	let storyData: StoryData;
	try {
		storyData = await loadCurrentStory(userId, logger);
	} catch (error) {
		if (error.type === 'story-error') {
			throw new StoryEngineError(StoryErrorType.StoryNotContinueable);
		} else {
			logger.error(error, 'Error while trying to load current story for user %s.', userId);
			throw new StoryEngineError(StoryErrorType.TemporaryProblem);
		}
	}

	if (storyData === null) {
		throw new StoryEngineError(StoryErrorType.StoryNotFound);
	}

	if (storyData.inkStory.hasError) {
		// Since this is a repeat of a previous state, these errors should already have been reported to the author so we don't need to do that here.
		// We also don't care about warnings for the same reason.
		throw new StoryEngineError(StoryErrorType.StoryNotContinueable);
	}

	const lines = [];
	const tags = storyData.inkStory.currentTags;
	lines.push({
		text: storyData.inkStory.currentText,
		tags
	});

	return {
		lines,
		choices: storyData.inkStory.currentChoices,
		variablesState: storyData.inkStory.variablesState,
		storyRecord: storyData.storyRecord,
		characters: parseCharacters(storyData.inkStory),
		defaultButtonStyle: parseDefaultButtonStyle(storyData.inkStory)
	};
}

function endStory(userId: string, logger: Logger) {
	try {
		clearCurrentStoryPlay(userId);
	} catch (error) {
		logger.error(error, 'Story state could not be cleared in database for user %s.', userId);
	}
	// TODO later: save story as finished. also check which ending we got (how does the story signal that? can we query the current knot? maybe the state of a specific variable?) and store that.
	//  if the user was the owner of the story or the story was in testing, don't record it as played? depends what I want to do with that information.
}

export function probeStory(storyContent: string): StoryProbe {
	const inkStory = new Story(storyContent);
	const stepData = runStoryStep(inkStory);
	if (!inkStory.asyncContinueComplete) {
		throw new StoryEngineError(StoryErrorType.TimeBudgetExceeded);
	}
	return {
		stepData,
		metadata: parseMetadata(inkStory)
	};
}

function informStoryOwner(
	client: Client,
	storyRecord: StoryRecord,
	reportType: OwnerReportType,
	issueDetails: string,
	lastLines: StoryLine[],
	logger: Logger
) {
	informStoryOwnerAsync(client, storyRecord, reportType, issueDetails, lastLines, logger).catch(error => {
		// If we can't send DMs to this user, we don't want to log that, as it's just a setting on their side, not an error on our side.
		if (!(error instanceof DiscordAPIError) || error.code !== API_ERROR_CODE__CANNOT_SEND_DMS_TO_USER) {
			// This should be a fire-and-forget action for the caller
			// (so that the reporting doesn't interfere with playing the story)
			// so we just log it and don't throw it further up the chain.
			logger.error(
				error,
				'Error while trying to inform story owner %s about story issues. Story id: %s',
				storyRecord.ownerId,
				storyRecord.id
			);
		}
	});
}

async function informStoryOwnerAsync(
	client: Client,
	storyRecord: StoryRecord,
	reportType: OwnerReportType,
	issueDetails: string,
	lastLines: StoryLine[],
	logger: Logger
) {
	if (!storyRecord.hasIssueBeenReported(reportType)) {
		const guild = await client.guilds.fetch(storyRecord.guildId);
		// Make sure the bot is still in this guild.
		if (guild) {
			const guildMember = await guild.members.fetch(storyRecord.ownerId);
			// Make sure the user is still in the guild.
			if (guildMember) {
				// Sadly we don't get access to the member's locale outside of interactions (probably for privacy reasons).
				// And we have no interaction with this user. So the best we can do is use the guild's locale.
				const guildConfig = getGuildConfig(storyRecord.guildId, logger);
				const locale: string = (guildConfig as FullGuildConfiguration).language ?? guild.preferredLocale ?? 'en';

				let message = translate('commands.story.owner-report.intro', {
					storyTitle: storyRecord.title,
					serverName: guild.name,
					lng: locale
				});
				message +=
					'\n' +
					translate('commands.story.owner-report.type-' + reportType, {
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
						translate('commands.story.owner-report.last-lines', { lng: locale }) +
						'\n' +
						lastLines
							// Only include the last MAX_LAST_LINES_TO_REPORT lines in the report.
							.slice(-MAX_LAST_LINES_TO_REPORT)
							.map(line => quote(line.text))
							.join('');
				}
				message += '\n' + translate('commands.story.owner-report.no-repeat', { lng: locale });

				// This *might* split up a quoted line but it's probably unlikely enough that it doesn't matter, it just looks a bit ugly/confusing then.
				const messages = splitTextAtWhitespace(message, EMBED_DESCRIPTION_CHARACTER_LIMIT);
				const dmChannel = await guildMember.createDM();
				for (const msg of messages) {
					await dmChannel.send({
						embeds: [new EmbedBuilder().setDescription(msg).setColor(COLOUR_DISCORD_YELLOW)]
					});
				}

				markIssueAsReported(storyRecord.id, reportType);
			}
		}
	}
}

export async function stopStoryPlayAndInformPlayers(
	storyRecord: StoryRecord,
	client: Client,
	getStartStoryButtonId: (storyId: string, guildId: string) => string,
	logger: Logger
) {
	try {
		const guild = await client.guilds.fetch(storyRecord.guildId);
		// Make sure the bot is still in this guild.
		if (guild) {
			const guildConfig = getGuildConfig(storyRecord.guildId, logger);
			const locale: string = (guildConfig as FullGuildConfiguration).language ?? guild.preferredLocale ?? 'en';
			const currentPlayers = getCurrentPlayers(storyRecord.id);
			let informPlayers = true;
			for (const userId of currentPlayers) {
				try {
					clearCurrentStoryPlay(userId);
					if (informPlayers) {
						await informPlayerAboutStoppedStoryPlay(userId, storyRecord, guild, locale, getStartStoryButtonId);
					}
				} catch (error) {
					// If we can't send DMs to this user, we don't want to log that, as it's just a setting on their side, not an error on our side.
					if (!(error instanceof DiscordAPIError) || error.code !== API_ERROR_CODE__CANNOT_SEND_DMS_TO_USER) {
						logger.error(
							error,
							'Error while trying to inform player %s about story play state being reset. Story id: %s',
							userId,
							storyRecord.id
						);
					}
					// If there are too many players, Discord might tell us we're opening DMs too fast.
					// In this case it's better to stop informing the rest of the players and only clear their story plays.
					if (error instanceof DiscordAPIError && error.code === API_ERROR_CODE__OPENING_DMS_TOO_FAST) {
						informPlayers = false;
					}
				}
			}
		}
	} catch (error) {
		logger.error(
			error,
			'Error while trying to inform players about story state being reset. Story id: %s',
			storyRecord.id
		);
	}
}

async function informPlayerAboutStoppedStoryPlay(
	userId: string,
	storyRecord: StoryRecord,
	guild: Guild,
	locale: string,
	getStartStoryButtonId: (storyId: string, guildId: string) => string
) {
	const guildMember = await guild.members.fetch(userId);
	// Make sure the user is still in the guild.
	if (guildMember) {
		const dmChannel = await guildMember.createDM();
		await dmChannel.send({
			embeds: [
				new EmbedBuilder()
					.setDescription(
						translate('commands.manage-stories.story-updated-and-stopped-notification', {
							storyTitle: storyRecord.title,
							serverName: guild.name,
							lng: locale
						})
					)
					.setColor(COLOUR_DISCORD_YELLOW)
			],
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							type: ComponentType.Button,
							style: ButtonStyle.Success,
							label: translate('commands.manage-stories.restart-button-label', {
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
