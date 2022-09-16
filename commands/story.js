import { Constants, MessageEmbed } from 'discord.js';
import {
	StoryErrorType,
	startStory,
	continueStory,
	restartStory,
	getCurrentStoryState
} from '../story/story-engine.js';
import { sendStoryStepData } from '../story/story-message-sender.js';
import { getStory, getStories, findMatchingStories, clearCurrentStoryPlay, StoryStatus } from '../storage/story-dao.js';
import { AUTOCOMPLETE_CHOICE_LIMIT } from '../util/discord-constants.js';
import {
	errorReply,
	warningReply,
	markSelectedButton,
	resetSelectionButtons,
	getCustomIdForCommandRouting,
	sendListReply
} from '../util/interaction-util.js';
import { getTranslatorForInteraction } from '../util/i18n.js';
import RandomMessageProvider from '../util/random-message-provider.js';

const postIntroMessages = new RandomMessageProvider()
	.add(t => t('reply.post-intro1'))
	.add(t => t('reply.post-intro2'))
	.add(t => t('reply.post-intro3'))
	.add(t => t('reply.post-intro4'))
	.add(t => t('reply.post-intro5'));

const startingStoryMessages = new RandomMessageProvider()
	.add(t => t('reply.starting-story1'))
	.add(t => t('reply.starting-story2'))
	.add(t => t('reply.starting-story3'))
	.add(t => t('reply.starting-story4'))
	.add(t => t('reply.starting-story5'))
	.add(t => t('reply.starting-story6'));

// TODO check that all log statements contain enough context

const storyCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'story',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'show',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'title',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false,
						autocomplete: true
					}
				]
			},
			{
				name: 'start',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'title',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						autocomplete: true
					}
				]
			},
			{
				name: 'restart',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND
			},
			{
				name: 'stop',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND
			},
			{
				name: 'state',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND
			}
		]
	},
	// Handler for when the command is used
	async execute(interaction, { t, logger }) {
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'show') {
			await handleShowStories(interaction, t, logger);
		} else if (subcommand === 'start') {
			await handleStartStory(interaction, t, logger);
		} else if (subcommand === 'restart') {
			await handleRestartStory(interaction, t, logger);
		} else if (subcommand === 'stop') {
			await handleStopStory(interaction, t, logger);
		} else if (subcommand === 'state') {
			await handleShowState(interaction, t, logger);
		} else {
			await t.privateReplyShared(interaction, 'unknown-command');
		}
	},
	async autocomplete(interaction, { logger }) {
		const focusedOption = interaction.options.getFocused(true);
		if (focusedOption.name === 'title') {
			// TODO later: not all stories might be available to the current user straight away. some might get unlocked by finishing other stories. saved as flags for user.
			const matchingStories = findMatchingStories(interaction.guildId, focusedOption.value, logger, true);
			let result = matchingStories.map(story => ({ name: story.title, value: story.id }));
			// Limit to the maximum number of results Discord accepts.
			result = result.slice(0, Math.min(result.length, AUTOCOMPLETE_CHOICE_LIMIT + 1));
			const collator = new Intl.Collator(interaction.locale);
			result = result.sort((a, b) => collator.compare(a?.title, b?.title));
			return result;
		} else {
			return [];
		}
	},
	async componentInteraction(interaction, innerCustomId, { t, logger }) {
		// TODO since not all interactions arriving here have the guild context, we could enhance the logger with the guildId from the story in some cases.

		if (innerCustomId.startsWith('choice ')) {
			const choiceIndex = parseInt(innerCustomId.substring('choice '.length));
			await handleChoiceSelection(interaction, choiceIndex, t, logger);
		} else if (innerCustomId.startsWith('start ')) {
			const storyId = innerCustomId.substring('start '.length);
			await startStoryWithId(interaction, storyId, t, logger);
		} else if (innerCustomId.startsWith('restart')) {
			await handleRestartStory(interaction, t, logger);
		} else if (innerCustomId.startsWith('stop')) {
			await handleStopStory(interaction, t, logger);
		} else if (innerCustomId.startsWith('state')) {
			await handleShowState(interaction, t, logger);
		} else {
			// This is not an interaction we can handle.
			// We need to reply to the interaction, otherwise it will be shown as pending and eventually failed.
			await t.privateReplyShared(interaction, 'unknown-command');
		}
	}
};

function getStartButton(t, storyId) {
	return getTranslatedStoryButton(t, 'start-button-label', 'start ' + storyId, Constants.MessageButtonStyles.SUCCESS);
}

function getRestartButton(t) {
	return getTranslatedStoryButton(t.user, 'restart-button-label', 'restart', Constants.MessageButtonStyles.DANGER);
}

function getStopButton(t) {
	return getTranslatedStoryButton(t.user, 'stop-button-label', 'stop', Constants.MessageButtonStyles.DANGER);
}

function getStateButton(t) {
	return getTranslatedStoryButton(t.user, 'state-button-label', 'state', Constants.MessageButtonStyles.SECONDARY);
}

function getTranslatedStoryButton(t, translationKey, innerCustomId, style) {
	return getStoryButton(t(translationKey), innerCustomId, style);
}

/**
 * A button that will route to this command when clicked.
 */
function getStoryButton(label, innerCustomId, style) {
	return {
		type: Constants.MessageComponentTypes.BUTTON,
		style: style ?? Constants.MessageButtonStyles.PRIMARY,
		label,
		custom_id: getStoryButtonId(innerCustomId)
	};
}

function getStoryButtonId(innerCustomId) {
	return getCustomIdForCommandRouting(storyCommand, innerCustomId);
}

async function handleShowStories(interaction, t, logger) {
	const guildId = interaction.guildId;
	const storyId = interaction.options.getString('title');

	if (storyId) {
		await postStoryInner(storyId, false, interaction, t, logger);
	} else {
		// TODO later: not all stories might be available to the current user straight away. some might get unlocked by finishing other stories. saved as flags for user.
		let guildStories = null;
		try {
			guildStories = getStories(guildId, true);
		} catch (error) {
			logger.error(error, 'Error while trying to fetch stories from db');
			await t.privateReplyShared(interaction, 'show-stories-failure');
			return;
		}
		const collator = new Intl.Collator(interaction.locale);
		const storyTitles = guildStories
			.map(story => {
				if (story.author) {
					return t.user('story-line', { title: story.title, author: story.author });
				}
				return story.title;
			})
			.sort(collator.compare);
		await sendListReply(interaction, storyTitles, t.user('reply.show-stories'), false, true);
	}
}

export async function postStory(storyId, publicly, interaction, guildConfig, logger) {
	// Make sure we use a translator tailored to this command when called from somewhere else, so that we can get to the right tanslations.
	const storyT = getTranslatorForInteraction(interaction, storyCommand, guildConfig);
	await postStoryInner(storyId, true, interaction, storyT, logger);
}

async function postStoryInner(storyId, publicly, interaction, t, logger) {
	let story = null;
	try {
		story = getStory(storyId);
	} catch (error) {
		logger.error(error, 'Error while trying to fetch story from db');
		await errorReply(interaction, t.userShared('story-db-fetch-error'));
		return;
	}
	if (!story) {
		await errorReply(interaction, t.userShared('story-not-found'));
		return;
	}
	if (story.status !== StoryStatus.Published) {
		await warningReply(interaction, t.user('reply.story-not-published'));
		return;
	}

	// TODO later: if publicly, check if the story has any unlock triggers.
	//  if so, it should not be visible to everyone, so don't post it and tell the user.

	let content;
	if (publicly) {
		content = postIntroMessages.any(t.guild);
	}

	const storyEmbed = getStoryEmbed(story, story.teaser);
	const components = [
		{
			type: Constants.MessageComponentTypes.ACTION_ROW,
			components: [getStartButton(publicly ? t.guild : t.user, storyId)],
			allowed_mentions: {
				parse: []
			}
		}
	];
	await interaction.reply({
		content,
		embeds: [storyEmbed],
		components,
		ephemeral: !publicly
	});
}

function getStoryEmbed(metadata, message) {
	// TODO have more ways to customise this embed message via more metadata saved in the story.
	//  maybe an image, maybe a colour for the side of the embed, maybe an author avatar, maybe a URL.
	const storyIntroEmbed = new MessageEmbed().setTitle(metadata.title);
	if (metadata.author) {
		storyIntroEmbed.setAuthor({ name: metadata.author });
	}
	if (message) {
		storyIntroEmbed.setDescription(message);
	}
	return storyIntroEmbed;
}

async function handleStartStory(interaction, t, logger) {
	const storyId = interaction.options.getString('title', true);
	await startStoryWithId(interaction, storyId, t, logger);
}

async function startStoryWithId(interaction, storyId, t, logger) {
	await interaction.deferReply({ ephemeral: true });

	try {
		const stepData = await startStory(interaction.user.id, storyId, interaction.client, logger);

		await interaction.editReply({
			content: startingStoryMessages.any(t.user),
			ephemeral: true
		});
		// TODO put buttons in there
		await sendStoryIntro(interaction, stepData.storyRecord, t);
		await sendStoryStepData(interaction, stepData, t, getStoryButtonId);
	} catch (error) {
		if (error.storyErrorType) {
			switch (error.storyErrorType) {
				case StoryErrorType.AlreadyPlayingDifferentStory: {
					const components = [
						{
							type: Constants.MessageComponentTypes.ACTION_ROW,
							components: [getStateButton(t), getStopButton(t)]
						}
					];
					await interaction.editReply({
						content: t.user('reply.already-playing'),
						components,
						ephemeral: true
					});
					return;
				}
				case StoryErrorType.StoryNotFound:
					await t.privateReplyShared(interaction, 'story-not-found');
					return;
				case StoryErrorType.StoryNotStartable:
				case StoryErrorType.StoryNotContinueable:
					await errorReply(interaction, t.user('reply.could-not-start-story'));
					return;
				case StoryErrorType.CouldNotSaveState: {
					const components = [
						{
							type: Constants.MessageComponentTypes.ACTION_ROW,
							components: [getStateButton(t), getRestartButton(t), getStopButton(t)]
						}
					];
					await errorReply(interaction, t.user('reply.could-not-save-state', components));
					return;
				}
				case StoryErrorType.TimeBudgetExceeded:
					await errorReply(interaction, t.user('reply.time-budget-exceeded'));
					return;
			}
		}

		// We don't know what this error is. Just rethrow and let interaction handling deal with it.
		throw error;
	}
}

async function sendStoryIntro(interaction, metadata, t) {
	// TODO add disclaimer that the content of the story is the sole responsibility of the author and the bot cannot be held responsible for it.
	//  similarly for /narrate, /alt, /goto, /bookmark? maybe not for command reply but somewhere else.
	await sendStoryEmbed(interaction, metadata, t.user('reply.story-intro1') + '\n' + t.user('reply.story-intro2'));
}

async function sendStoryEmbed(interaction, metadata, message) {
	// TODO Restart and stop buttons? Secondary so they're not too inviting.
	//  see also interaction.reply in handleShowState which would also need the button. maybe extract a method creating the whole message.
	await interaction.user.send({
		embeds: [getStoryEmbed(metadata, message)]
	});
}

async function handleChoiceSelection(interaction, choiceIndex, t, logger) {
	// This counts as replying to the interaction. All later replies (like error reporting) are therefore followUps.
	await markSelectedButton(interaction);

	try {
		const stepData = await continueStory(interaction.user.id, choiceIndex, interaction.client, logger);
		await sendStoryStepData(interaction, stepData, t, getStoryButtonId);
	} catch (error) {
		if (error.storyErrorType) {
			switch (error.storyErrorType) {
				case StoryErrorType.StoryNotFound:
					await t.privateReply(interaction, 'reply.no-story-running');
					return;
				case StoryErrorType.StoryNotContinueable:
					await errorReply(interaction, t.user('reply.could-not-continue-story'));
					return;
				case StoryErrorType.CouldNotSaveState: {
					const components = [
						{
							type: Constants.MessageComponentTypes.ACTION_ROW,
							components: [getStateButton(t), getRestartButton(t), getStopButton(t)]
						}
					];
					await errorReply(interaction, t.user('reply.could-not-save-state'), components);
					return;
				}
				case StoryErrorType.InvalidChoice:
					await t.privateReply(interaction, 'reply.invalid-choice');
					return;
				case StoryErrorType.TimeBudgetExceeded:
					// Re-enable the buttons so user can try again.
					await resetSelectionButtons(interaction);
					await errorReply(interaction, t.user('reply.time-budget-exceeded'));
					return;
			}
		}

		// We don't know what this error is. Just rethrow and let interaction handling deal with it.
		throw error;
	}
}

async function handleRestartStory(interaction, t, logger) {
	await interaction.deferReply({ ephemeral: true });

	try {
		const stepData = await restartStory(interaction.user.id, interaction.client, logger);
		await t.privateReply(interaction, 'reply.reset-story-success');
		await sendStoryIntro(interaction, stepData.storyRecord, t);
		await sendStoryStepData(interaction, stepData, t, getStoryButtonId);
	} catch (error) {
		if (error.storyErrorType) {
			switch (error.storyErrorType) {
				case StoryErrorType.StoryNotFound:
					await t.privateReply(interaction, 'reply.no-story-running');
					return;
				case StoryErrorType.StoryNotContinueable:
					await errorReply(interaction, t.user('reply.story-state-fetch-failure'));
					return;
				case StoryErrorType.CouldNotSaveState: {
					const components = [
						{
							type: Constants.MessageComponentTypes.ACTION_ROW,
							components: [getStateButton(t), getRestartButton(t), getStopButton(t)]
						}
					];
					await errorReply(interaction, t.user('reply.could-not-save-state'), components);
					return;
				}
				case StoryErrorType.TimeBudgetExceeded:
					await errorReply(interaction, t.user('reply.time-budget-exceeded'));
					return;
			}
		}

		// We don't know what this error is. Just rethrow and let interaction handling deal with it.
		throw error;
	}
}

async function handleStopStory(interaction, t, logger) {
	try {
		clearCurrentStoryPlay(interaction.user.id);
	} catch (error) {
		logger.error(error, 'Error while trying to clear current story play for user %s in database.', interaction.user.id);
		await t.privateReply(interaction, 'reply.stop-story-failure');
		return;
	}
	await t.privateReply(interaction, 'reply.stop-story-success');
}

async function handleShowState(interaction, t, logger) {
	try {
		const stepData = await getCurrentStoryState(interaction.user.id, logger);

		if (interaction.guildId) {
			// The status was requested via an interaction in the guild, so we first need to reply to the interaction and then send the state embed to the DMs.
			await t.privateReply(interaction, 'reply.story-state-success');
			await sendStoryEmbed(interaction, stepData.storyRecord, t.user('reply.story-state-repeat'));
		} else {
			// The status was requested by a button click in the DMs so we can reply with the state embed straightaway.
			await interaction.reply({
				embeds: [getStoryEmbed(stepData.storyRecord, t.user('reply.story-state-repeat'))]
			});
		}
		await sendStoryStepData(interaction, stepData, t, getStoryButtonId);
	} catch (error) {
		if (error.storyErrorType) {
			switch (error.storyErrorType) {
				case StoryErrorType.StoryNotFound:
					await t.privateReply(interaction, 'reply.no-story-running');
					return;
				case StoryErrorType.StoryNotContinueable:
					await errorReply(interaction, t.user('reply.story-state-fetch-failure'));
					return;
			}
		}

		// We don't know what this error is. Just rethrow and let interaction handling deal with it.
		throw error;
	}
}

export default storyCommand;
