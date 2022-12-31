import {
	ApplicationCommandType,
	ApplicationCommandOptionType,
	DiscordAPIError,
	EmbedBuilder,
	ButtonStyle,
	ComponentType,
	ChatInputCommandInteraction,
	MessageComponentInteraction,
	ButtonBuilder
} from 'discord.js';
import { TFunction } from 'i18next';
import { Logger } from 'pino';
import { GuildCommandModule } from '../command-module-types.js';
import { GuildConfiguration, StoryRecord, StoryStatus } from '../../storage/record-types.js';
import { ContextTranslatorFunctions, InteractionButtonStyle } from '../../util/interaction-types.js';
import { StoryErrorType, StoryMetadata } from '../../story/story-types.js';
import { startStory, continueStory, restartStory, getCurrentStoryState } from '../../story/story-engine.js';
import { sendStoryStepData } from '../../story/story-message-sender.js';
import {
	getStory,
	getStories,
	findMatchingStories,
	getNumberOfStories,
	clearCurrentStoryPlay
} from '../../storage/story-dao.js';
import { API_ERROR_CODE__CANNOT_SEND_DMS_TO_USER, AUTOCOMPLETE_CHOICE_LIMIT } from '../../util/discord-constants.js';
import {
	errorReply,
	warningReply,
	markSelectedButton,
	resetSelectionButtons,
	getCustomIdForCommandRouting,
	isStringSelectMenuInteraction,
	isChatInputCommandInteraction
} from '../../util/interaction-util.js';
import { getTranslatorForInteraction } from '../../util/i18n.js';
import RandomMessageProvider from '../../util/random-message-provider.js';

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

const storyCommand: GuildCommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'story',
		description: '',
		type: ApplicationCommandType.ChatInput,
		options: [
			{
				name: 'show',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'title',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: false,
						autocomplete: true
					}
				]
			},
			{
				name: 'start',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'title',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: true,
						autocomplete: true
					}
				]
			},
			{
				name: 'restart',
				description: '',
				type: ApplicationCommandOptionType.Subcommand
			},
			{
				name: 'stop',
				description: '',
				type: ApplicationCommandOptionType.Subcommand
			},
			{
				name: 'state',
				description: '',
				type: ApplicationCommandOptionType.Subcommand
			}
		]
	},
	guard(client, guild, guildConfig, logger) {
		return getNumberOfStories(guild.id, logger) > 0;
	},
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
			const matchingStories = findMatchingStories(
				interaction.guildId,
				interaction.user.id,
				focusedOption.value,
				logger,
				true
			);
			let result = matchingStories.map(story => ({ name: story.title, value: story.id }));
			// Limit to the maximum number of results Discord accepts.
			result = result.slice(0, Math.min(result.length, AUTOCOMPLETE_CHOICE_LIMIT + 1));
			const collator = new Intl.Collator(interaction.locale);
			result = result.sort((a, b) => collator.compare(a?.name, b?.name));
			return result;
		} else {
			return [];
		}
	},
	async componentInteraction(interaction, innerCustomId, { t, logger }) {
		if (innerCustomId.startsWith('choice ')) {
			const choiceIndex = parseInt(innerCustomId.substring('choice '.length));
			// The logger won't have the guildId in this case since this interaction happens outside of a guild.
			// To fix this we'd have to fetch the guildId from the story first and enhance the logger as done for the start button below.
			// Since that's awkward, the better solution is to make sure log statements provide enough other context for solving problems.
			await handleChoiceSelection(interaction, choiceIndex, t, logger);
		} else if (innerCustomId.startsWith('start ')) {
			const spaceIndex = innerCustomId.lastIndexOf(' ');
			const storyId = innerCustomId.substring('start '.length, spaceIndex);
			const guildId = innerCustomId.substring(spaceIndex + 1);
			const innerLogger = logger.child({ interactionId: interaction.id, guildId });
			await startStoryWithId(interaction, storyId, guildId, t, innerLogger);
		} else if (innerCustomId.startsWith('restart')) {
			await handleRestartStory(interaction, t, logger);
		} else if (innerCustomId.startsWith('stop')) {
			await handleStopStory(interaction, t, logger);
		} else if (innerCustomId.startsWith('state')) {
			await handleShowState(interaction, t, logger);
		} else if (innerCustomId.startsWith('show')) {
			await handleShowStories(interaction, t, logger);
		} else {
			// This is not an interaction we can handle.
			// We need to reply to the interaction, otherwise it will be shown as pending and eventually failed.
			await t.privateReplyShared(interaction, 'unknown-command');
		}
	}
};

function getStartButton(t: TFunction, storyId: string, guildId: string) {
	return getTranslatedStoryButton(t, 'start-button-label', 'start ' + storyId + ' ' + guildId, ButtonStyle.Success);
}

function getRestartButton(t: ContextTranslatorFunctions, short?: boolean) {
	return getTranslatedStoryButton(
		t.user,
		short ? 'restart-button-label-short' : 'restart-button-label',
		'restart',
		short ? ButtonStyle.Secondary : ButtonStyle.Danger
	);
}

function getStopButton(t: ContextTranslatorFunctions, short?: boolean) {
	return getTranslatedStoryButton(
		t.user,
		short ? 'stop-button-label-short' : 'stop-button-label',
		'stop',
		short ? ButtonStyle.Secondary : ButtonStyle.Danger
	);
}

function getStateButton(t: ContextTranslatorFunctions) {
	return getTranslatedStoryButton(t.user, 'state-button-label', 'state', ButtonStyle.Secondary);
}

function getTranslatedStoryButton(
	t: TFunction,
	translationKey: string,
	innerCustomId: string,
	style: InteractionButtonStyle
) {
	return getStoryButton(t(translationKey), innerCustomId, style);
}

/**
 * A button that will route to this command when clicked.
 */
function getStoryButton(label: string, innerCustomId: string, style: InteractionButtonStyle = ButtonStyle.Primary) {
	return new ButtonBuilder({
		type: ComponentType.Button,
		style,
		label,
		custom_id: getStoryComponentId(innerCustomId)
	});
}

function getStoryComponentId(innerCustomId: string) {
	return getCustomIdForCommandRouting(storyCommand, innerCustomId);
}

export function getStartStoryButtonId(storyId: string, guildId: string) {
	return getStoryComponentId('start ' + storyId + ' ' + guildId);
}

function isCannotSendDMsError(error: any) {
	return error instanceof DiscordAPIError && error.code === API_ERROR_CODE__CANNOT_SEND_DMS_TO_USER;
}

async function handleShowStories(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	const guildId = interaction.guildId;
	let storyId: string | null = null;
	if (isStringSelectMenuInteraction(interaction) && interaction.values.length) {
		storyId = interaction.values[0];
	} else if (isChatInputCommandInteraction(interaction)) {
		storyId = interaction.options?.getString('title');
	}

	if (storyId) {
		await postStoryInner(storyId, false, interaction, t, logger);
	} else {
		// TODO later: not all stories might be available to the current user straight away. some might get unlocked by finishing other stories. saved as flags for user.
		let guildStories: StoryRecord[] = null;
		try {
			guildStories = getStories(guildId, interaction.user.id, true);
		} catch (error) {
			logger.error(error, 'Error while trying to fetch stories for guild %s from database', guildId);
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
		const embedTitle = t.user('show-stories-title');
		const titlesText = storyTitles.join('\n');
		const options = guildStories.map(story => ({
			label: story.title,
			value: story.id
		}));
		await interaction.reply({
			embeds: [new EmbedBuilder().setTitle(embedTitle).setDescription(titlesText)],
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							type: ComponentType.StringSelect,
							custom_id: getStoryComponentId('show'),
							placeholder: t.userShared('show-story-details-select-label'),
							options
						}
					]
				}
			],
			ephemeral: true
		});
	}
}

export async function postStory(
	storyId: string,
	publicly: boolean,
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	guildConfig: GuildConfiguration,
	logger: Logger
) {
	// Make sure we use a translator tailored to this command when called from somewhere else, so that we can get to the right tanslations.
	const storyT = getTranslatorForInteraction(interaction, storyCommand, guildConfig);
	await postStoryInner(storyId, publicly, interaction, storyT, logger);
}

async function postStoryInner(
	storyId: string,
	publicly: boolean,
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	let story: StoryRecord | null = null;
	try {
		story = getStory(storyId, interaction.guildId);
	} catch (error) {
		logger.error(error, 'Error while trying to fetch story %s from database', storyId);
		await errorReply(interaction, t.userShared('story-db-fetch-error'));
		return;
	}
	if (!story) {
		await warningReply(interaction, t.userShared('story-not-found'));
		return;
	}
	if (publicly && story.status !== StoryStatus.Published) {
		await warningReply(interaction, t.user('reply.story-not-published'));
		return;
	}

	// TODO later: if publicly, check if the story has any unlock triggers.
	//  if so, it should not be visible to everyone, so don't post it and tell the user.

	let content: string;
	if (publicly) {
		content = postIntroMessages.any(t.guild);
	}

	const storyEmbed = getDefaultStoryEmbed(story);
	const components = [
		{
			type: ComponentType.ActionRow,
			components: [getStartButton(publicly ? t.guild : t.user, storyId, interaction.guildId)]
		}
	];
	const message = {
		content,
		embeds: [storyEmbed],
		components,
		ephemeral: !publicly
	};
	if (interaction.replied) {
		await interaction.followUp(message);
	} else {
		await interaction.reply(message);
	}
}

function getStoryEmbed(metadata: StoryMetadata, description: string) {
	// TODO later: have more ways to customise this embed message via more metadata saved in the story.
	//  maybe an image, maybe a colour for the side of the embed, maybe an author avatar, maybe a URL.
	const storyIntroEmbed = new EmbedBuilder().setTitle(metadata.title);
	if (metadata.author) {
		storyIntroEmbed.setAuthor({ name: metadata.author });
	}
	if (description) {
		storyIntroEmbed.setDescription(description);
	}
	return storyIntroEmbed;
}

export function getDefaultStoryEmbed(metadata: StoryMetadata) {
	return getStoryEmbed(metadata, metadata.teaser);
}

async function handleStartStory(
	interaction: ChatInputCommandInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	const storyId = interaction.options.getString('title', true);
	await startStoryWithId(interaction, storyId, interaction.guildId, t, logger);
}

async function startStoryWithId(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	storyId: string,
	guildId: string,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	await interaction.deferReply({ ephemeral: !!interaction.guildId });

	try {
		const stepData = await startStory(interaction.user.id, storyId, guildId, interaction.client, logger);

		if (interaction.guildId) {
			// This story was started from a server, so we need to send the intro to the DMs
			// and then reply to the interaction in the server.
			await sendStoryIntro(interaction, stepData.storyRecord, t);
			// Now we're sure we can send DMs, we can reply to the interaction, telling them to go to their DMs.
			await interaction.editReply({
				content: startingStoryMessages.any(t.user)
			});
		} else {
			// This came from a button press in the user's DMs, so we send the story intro as a reply to the interaction,
			// instead of sending a reply separately.
			await sendStoryIntro(interaction, stepData.storyRecord, t, true);
		}

		await sendStoryStepData(interaction, stepData, t, getStoryComponentId, getStartStoryButtonId(storyId, guildId));
	} catch (error) {
		if (error.storyErrorType) {
			switch (error.storyErrorType) {
				case StoryErrorType.AlreadyPlayingDifferentStory: {
					const components = [
						{
							type: ComponentType.ActionRow,
							components: [getStateButton(t), getStopButton(t)]
						}
					];
					await interaction.editReply({
						content: t.user('reply.already-playing'),
						components
					});
					return;
				}
				case StoryErrorType.StoryNotFound:
					await warningReply(interaction, t.userShared('story-not-found'));
					return;
				case StoryErrorType.StoryNotStartable:
				case StoryErrorType.StoryNotContinueable:
					await errorReply(interaction, t.user('reply.could-not-start-story'));
					return;
				case StoryErrorType.CouldNotSaveState: {
					const components = [
						{
							type: ComponentType.ActionRow,
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

		if (isCannotSendDMsError(error)) {
			try {
				clearCurrentStoryPlay(interaction.user.id);
			} catch (error) {
				logger.error(
					error,
					'Error while trying to clear current story play for user %s in database.',
					interaction.user.id
				);
			}
			await warningReply(interaction, t.user('reply.cannot-send-dms'));
			return;
		}

		// We don't know what this error is. Just rethrow and let interaction handling deal with it.
		throw error;
	}
}

async function sendStoryIntro(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	metadata: StoryMetadata,
	t: ContextTranslatorFunctions,
	reply?: boolean
) {
	await sendStoryEmbed(
		interaction,
		metadata,
		t.user('reply.story-intro1') + '\n' + t.user('reply.story-intro2') + '\n' + t.user('reply.story-intro3'),
		t,
		reply
	);
}

async function sendStoryEmbed(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	metadata: StoryMetadata,
	description: string,
	t: ContextTranslatorFunctions,
	reply?: boolean
) {
	const message = {
		embeds: [getStoryEmbed(metadata, description)],
		components: [
			{
				type: ComponentType.ActionRow,
				components: [getRestartButton(t, true), getStopButton(t, true)]
			}
		]
	};
	if (reply) {
		if (interaction.deferred) {
			await interaction.editReply(message);
		} else {
			await interaction.reply(message);
		}
	} else {
		await interaction.user.send(message);
	}
}

async function handleChoiceSelection(
	interaction: MessageComponentInteraction,
	choiceIndex: number,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	// This counts as replying to the interaction. All later replies (like error reporting) are therefore followUps.
	await markSelectedButton(interaction);

	try {
		const stepData = await continueStory(interaction.user.id, choiceIndex, interaction.client, logger);
		await sendStoryStepData(
			interaction,
			stepData,
			t,
			getStoryComponentId,
			getStartStoryButtonId(stepData.storyRecord.id, stepData.storyRecord.guildId)
		);
	} catch (error) {
		if (error.storyErrorType) {
			switch (error.storyErrorType) {
				case StoryErrorType.StoryNotFound:
					await t.privateReply(interaction, 'reply.no-story-running');
					return;
				case StoryErrorType.StoryNotContinueable:
					await errorReply(interaction, t.user('reply.could-not-continue-story'));
					return;
				case StoryErrorType.TemporaryProblem:
					// Re-enable the buttons so user can try again.
					await resetSelectionButtons(interaction);
					await errorReply(interaction, t.user('reply.temporary-problem'));
					return;
				case StoryErrorType.CouldNotSaveState: {
					const components = [
						{
							type: ComponentType.ActionRow,
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

		if (isCannotSendDMsError(error)) {
			// We shouldn't really end up here: If the user does not allow DMs from the bot anymore but clicks on a button in their DMs,
			// the interaction will just fail on Discord's end and we won't even receive it.
			await warningReply(interaction, t.user('reply.cannot-send-dms'));
			return;
		}

		// We don't know what this error is. Just rethrow and let interaction handling deal with it.
		throw error;
	}
}

async function handleRestartStory(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	await interaction.deferReply({ ephemeral: true });

	try {
		const stepData = await restartStory(interaction.user.id, interaction.client, logger);
		await sendStoryIntro(interaction, stepData.storyRecord, t);
		await t.privateReply(interaction, 'reply.reset-story-success');
		await sendStoryStepData(
			interaction,
			stepData,
			t,
			getStoryComponentId,
			getStartStoryButtonId(stepData.storyRecord.id, stepData.storyRecord.guildId)
		);
	} catch (error) {
		if (error.storyErrorType) {
			switch (error.storyErrorType) {
				case StoryErrorType.StoryNotFound:
					await t.privateReply(interaction, 'reply.no-story-running');
					return;
				case StoryErrorType.StoryNotContinueable:
					await errorReply(interaction, t.user('reply.story-state-fetch-failure'));
					return;
				case StoryErrorType.TemporaryProblem:
					await errorReply(interaction, t.user('reply.temporary-problem'));
					return;
				case StoryErrorType.CouldNotSaveState: {
					const components = [
						{
							type: ComponentType.ActionRow,
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

		if (isCannotSendDMsError(error)) {
			try {
				// The ideal solution would be to reset it to the previous state,
				// but it is so unlikely that we will not be able to send the user DMs
				// at this stage and their intention was to start from the beginning anyway,
				// so stopping it entirely should be fine.
				clearCurrentStoryPlay(interaction.user.id);
			} catch (error) {
				logger.error(
					error,
					'Error while trying to clear current story play for user %s in database.',
					interaction.user.id
				);
			}
			await warningReply(interaction, t.user('reply.cannot-send-dms'));
			return;
		}

		// We don't know what this error is. Just rethrow and let interaction handling deal with it.
		throw error;
	}
}

async function handleStopStory(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	let found: boolean;
	try {
		found = clearCurrentStoryPlay(interaction.user.id);
	} catch (error) {
		logger.error(error, 'Error while trying to clear current story play for user %s in database.', interaction.user.id);
		await t.privateReply(interaction, 'reply.stop-story-failure');
		return;
	}
	if (!found) {
		await t.privateReply(interaction, 'reply.no-story-running');
	} else {
		await t.privateReply(interaction, 'reply.stop-story-success');
	}
}

async function handleShowState(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	try {
		const stepData = await getCurrentStoryState(interaction.user.id, logger);

		if (interaction.guildId) {
			// The status was requested via an interaction in the guild,
			// so we need to send the state embed to the DMs and reply to the interaction.
			await sendStoryEmbed(interaction, stepData.storyRecord, t.user('reply.story-state-repeat'), t, false);
			await t.privateReply(interaction, 'reply.story-state-success');
		} else {
			// The status was requested by a button click in the DMs,
			// so we can reply with the state embed straightaway.
			await sendStoryEmbed(interaction, stepData.storyRecord, t.user('reply.story-state-repeat'), t, true);
		}
		await sendStoryStepData(
			interaction,
			stepData,
			t,
			getStoryComponentId,
			getStartStoryButtonId(stepData.storyRecord.id, stepData.storyRecord.guildId)
		);
	} catch (error) {
		if (error.storyErrorType) {
			switch (error.storyErrorType) {
				case StoryErrorType.StoryNotFound:
					await t.privateReply(interaction, 'reply.no-story-running');
					return;
				case StoryErrorType.StoryNotContinueable:
					await errorReply(interaction, t.user('reply.story-state-fetch-failure'));
					return;
				case StoryErrorType.TemporaryProblem:
					await errorReply(interaction, t.user('reply.temporary-problem'));
					return;
			}
		}

		if (isCannotSendDMsError(error)) {
			// Since we didn't change any state, we just need to inform the user about the problem
			// and not do anything else.
			await warningReply(interaction, t.user('reply.cannot-send-dms'));
			return;
		}

		// We don't know what this error is. Just rethrow and let interaction handling deal with it.
		throw error;
	}
}

export default storyCommand;
