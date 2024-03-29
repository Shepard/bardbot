import {
	ApplicationCommandType,
	ApplicationCommandOptionType,
	PermissionFlagsBits,
	ButtonStyle,
	ComponentType,
	EmbedBuilder,
	ModalBuilder,
	ActionRowBuilder,
	TextInputBuilder,
	TextInputStyle,
	quote,
	userMention,
	ChatInputCommandInteraction,
	InteractionReplyOptions,
	ButtonBuilder,
	MessageComponentInteraction,
	ModalSubmitInteraction,
	StringSelectMenuBuilder,
	ChannelSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	ChannelType,
	ModalMessageModalSubmitInteraction,
	APIStringSelectComponent,
	AnyComponent,
	BaseInteraction,
	ActionRowData,
	MessageActionRowComponentBuilder
} from 'discord.js';
import { Logger } from 'pino';
import axios from 'axios';
import { CommandModule } from '../command-module-types.js';
import { GuildConfiguration, StoryRecord, StoryStatus, StorySuggestion } from '../../storage/record-types.js';
import { ContextTranslatorFunctions, InteractionButtonStyle } from '../../util/interaction-types.js';
import { StoryErrorType, StoryMetadata, StoryProbe } from '../../story/story-types.js';
import {
	addStory,
	getNumberOfStories,
	replaceStoryContent,
	getStory,
	getStories,
	findMatchingStories,
	changeStoryMetadata,
	completeStoryMetadata,
	changeStoryOwner,
	moveStoryToTesting,
	publishStory,
	markStoryForDeletion,
	setStoryStatus,
	deleteStory,
	publishStoryUnlisted,
	addOrEditStorySuggestion,
	getStorySuggestion,
	getSuggestedStories,
	deleteStorySuggestion
} from '../../storage/story-dao.js';
import {
	AUTOCOMPLETE_CHOICE_LIMIT,
	COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT,
	SELECT_CHOICE_LIMIT
} from '../../util/discord-constants.js';
import {
	getCustomIdForCommandRouting,
	errorReply,
	warningReply,
	disableButtons,
	isStringSelectMenuInteraction,
	isChatInputCommandInteraction,
	isChannelSelectMenuInteraction,
	isModalSubmitInteraction
} from '../../util/interaction-util.js';
import { probeStory, stopStoryPlayAndInformPlayers } from '../../story/story-engine.js';
import storyCommand, { postStory, getStartStoryButtonId, getDefaultStoryEmbed } from './story.js';
import { enumFromStringValue, trimText } from '../../util/helpers.js';
import { updateCommandsAfterConfigChange } from './config.js';
import { getSuggestionEmbed } from '../../story/story-message-sender.js';
import { getTranslatorForInteraction } from '../../util/i18n.js';

// To make sure malicious guilds can't fill up the bot's hard drive,
// we limit both the file size of story files and the number of stories per guild.
const MAX_STORY_FILE_SIZE = 1000000;
// This is based on how many stories we can show in a select menu which is useful for the show command.
const MAX_STORIES_PER_GUILD = SELECT_CHOICE_LIMIT;
// Limiting the length of the title to this so that the title is a valid option label in the autocomplete for stories.
const MAX_TITLE_LENGTH = COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT;
// Just choosing a limit that is aligned with the title length here.
const MAX_AUTHOR_LENGTH = 100;
// Something that will easily fit into a message.
const MAX_TEASER_LENGTH = 1000;

const CHANNEL_MENTION_PATTERN = /<#(\d+)>/;

const manageStoriesCommand: CommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'manage-stories',
		description: '',
		type: ApplicationCommandType.ChatInput,
		defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
		dmPermission: false,
		options: [
			{
				name: 'create',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'ink-file',
						description: '',
						type: ApplicationCommandOptionType.Attachment,
						required: true
					},
					{
						name: 'owner',
						description: '',
						type: ApplicationCommandOptionType.User,
						required: false
					}
				]
			},
			{
				name: 'edit',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'title',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: true,
						autocomplete: true,
						max_length: COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT
					},
					{
						name: 'ink-file',
						description: '',
						type: ApplicationCommandOptionType.Attachment,
						required: false
					},
					{
						name: 'owner',
						description: '',
						type: ApplicationCommandOptionType.User,
						required: false
					}
				]
			},
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
						autocomplete: true,
						max_length: COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT
					}
				]
			}
		]
	},
	async execute(interaction, { t, logger }) {
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'create') {
			await handleCreateStory(interaction, t, logger);
		} else if (subcommand === 'edit') {
			await handleEditStory(interaction, t, logger);
		} else if (subcommand === 'show') {
			await handleShowStories(interaction, t, logger);
		} else {
			await warningReply(interaction, t.userShared('unknown-command'));
		}
	},
	async autocomplete(interaction, { logger }) {
		const focusedOption = interaction.options.getFocused(true);
		if (focusedOption.name === 'title') {
			const matchingStories = findMatchingStories(
				interaction.guildId,
				interaction.user.id,
				focusedOption.value,
				logger,
				false
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
	async modalInteraction(interaction, innerCustomId, { t, logger, guildConfig }) {
		if (innerCustomId.startsWith('metadata ')) {
			const storyId = innerCustomId.substring('metadata '.length);
			await handleMetadataDialogSubmit(storyId, interaction, t, logger);
		} else if (innerCustomId.startsWith('publish-custom-message-post ') && interaction.isFromMessage()) {
			const storyId = innerCustomId.substring('publish-custom-message-post '.length);
			await handlePublishStory(interaction, storyId, true, t, guildConfig, logger);
		} else if (innerCustomId.startsWith('custom-message-post ') && interaction.isFromMessage()) {
			const storyId = innerCustomId.substring('custom-message-post '.length);
			await handlePostStory(interaction, storyId, guildConfig, logger);
		} else if (innerCustomId.startsWith('save-sug ') && interaction.isFromMessage()) {
			const spaceIndex = innerCustomId.lastIndexOf(' ');
			const storyId = innerCustomId.substring('save-sug '.length, spaceIndex);
			const suggestedStoryId = innerCustomId.substring(spaceIndex + 1);
			await handleSuggestStoryDialogSubmit(interaction, storyId, suggestedStoryId, t, guildConfig, logger);
		} else {
			await warningReply(interaction, t.userShared('unknown-command'));
		}
	},
	async componentInteraction(interaction, innerCustomId, { t, logger, guildConfig }) {
		if (innerCustomId.startsWith('edit-metadata ')) {
			const storyId = innerCustomId.substring('edit-metadata '.length);
			await handleTriggerEditMetadataDialog(interaction, storyId, t, logger);
		} else if (innerCustomId.startsWith('delete ')) {
			const storyId = innerCustomId.substring('delete '.length);
			await handleDeleteStory(interaction, storyId, t, logger);
		} else if (innerCustomId.startsWith('undo-delete ')) {
			const spaceIndex = innerCustomId.lastIndexOf(' ');
			const storyId = innerCustomId.substring('undo-delete '.length, spaceIndex);
			const previousStatus = innerCustomId.substring(spaceIndex + 1);
			await handleUndoDeleteStory(interaction, storyId, previousStatus, t, logger);
		} else if (innerCustomId.startsWith('publish-wizard ')) {
			const storyId = innerCustomId.substring('publish-wizard '.length);
			await handleShowPublishStoryWizard(interaction, storyId, null, t);
		} else if (innerCustomId.startsWith('publish-listed ')) {
			const storyId = innerCustomId.substring('publish-listed '.length);
			await handleShowPublishStoryWizard(interaction, storyId, 'publish-listed', t);
		} else if (innerCustomId.startsWith('publish-in-channel ')) {
			const storyId = innerCustomId.substring('publish-in-channel '.length);
			await handleShowPublishStoryWizard(interaction, storyId, 'publish-in-channel', t);
		} else if (innerCustomId.startsWith('publish-and-post ')) {
			const storyId = innerCustomId.substring('publish-and-post '.length);
			await handlePublishStory(interaction, storyId, true, t, guildConfig, logger);
		} else if (innerCustomId.startsWith('publish-with-custom-message ')) {
			const storyId = innerCustomId.substring('publish-with-custom-message '.length);
			await handleTriggerCustomPostMessageDialog(interaction, storyId, true, t);
		} else if (innerCustomId.startsWith('publish ')) {
			const storyId = innerCustomId.substring('publish '.length);
			await handlePublishStory(interaction, storyId, false, t, guildConfig, logger);
		} else if (innerCustomId.startsWith('post ')) {
			const storyId = innerCustomId.substring('post '.length);
			await handlePostStory(interaction, storyId, guildConfig, logger);
		} else if (innerCustomId.startsWith('post-with-custom-message ')) {
			const storyId = innerCustomId.substring('post-with-custom-message '.length);
			await handleTriggerCustomPostMessageDialog(interaction, storyId, false, t);
		} else if (innerCustomId.startsWith('make-listed ')) {
			const storyId = innerCustomId.substring('make-listed '.length);
			await handleChangeListedStatus(interaction, storyId, true, t, logger);
		} else if (innerCustomId.startsWith('make-unlisted ')) {
			const storyId = innerCustomId.substring('make-unlisted '.length);
			await handleChangeListedStatus(interaction, storyId, false, t, logger);
		} else if (innerCustomId.startsWith('suggested-story-wizard ')) {
			const storyId = innerCustomId.substring('suggested-story-wizard '.length);
			await handleShowSuggestedStoryWizard(interaction, storyId, false, t, logger);
		} else if (innerCustomId.startsWith('suggest-story ')) {
			const storyId = innerCustomId.substring('suggest-story '.length);
			await handleSelectStoryToSuggest(interaction, storyId, t, guildConfig, logger);
		} else if (innerCustomId.startsWith('select-story-suggestion ')) {
			const storyId = innerCustomId.substring('select-story-suggestion '.length);
			await handleSelectStorySuggestionForEditing(interaction, storyId, t, guildConfig, logger);
		} else if (innerCustomId.startsWith('edit-sug ')) {
			const spaceIndex = innerCustomId.lastIndexOf(' ');
			const storyId = innerCustomId.substring('edit-sug '.length, spaceIndex);
			const suggestedStoryId = innerCustomId.substring(spaceIndex + 1);
			await handleTriggerSuggestStoryDialog(interaction, storyId, suggestedStoryId, t, guildConfig, logger);
		} else if (innerCustomId.startsWith('del-sug ')) {
			const spaceIndex = innerCustomId.lastIndexOf(' ');
			const storyId = innerCustomId.substring('del-sug '.length, spaceIndex);
			const suggestedStoryId = innerCustomId.substring(spaceIndex + 1);
			await handleDeleteSuggestion(interaction, storyId, suggestedStoryId, t, logger);
		} else if (innerCustomId.startsWith('return-to-suggested-story-wizard ')) {
			const storyId = innerCustomId.substring('return-to-suggested-story-wizard '.length);
			await handleShowSuggestedStoryWizard(interaction, storyId, true, t, logger);
		} else if (innerCustomId.startsWith('show')) {
			await handleShowStories(interaction, t, logger);
		} else {
			await warningReply(interaction, t.userShared('unknown-command'));
		}
	}
};

async function handleCreateStory(
	interaction: ChatInputCommandInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
): Promise<void> {
	const numStories = getNumberOfStories(interaction.guildId, logger, true);
	if (numStories + 1 > MAX_STORIES_PER_GUILD) {
		await warningReply(interaction, t.user('reply.max-stories-reached'));
		return null;
	}

	// Downloading and testing the story and writing it to disk can take a while, so we defer the reply to get more time to reply.
	await interaction.deferReply({ ephemeral: true });

	const storyData = await loadStoryFromParameter(interaction, true, t, logger);
	if (storyData) {
		const owner = interaction.options.getUser('owner');
		// If no owner is supplied or we can't accept the selected user, default to the user who uploaded the story.
		let ownerId = interaction.user.id;
		// We don't allow picking the bot itself or any other bot (cause we can't DM those) as the owner.
		if (owner && owner.id !== interaction.client.user.id && !owner.bot) {
			ownerId = owner.id;
		}

		const initialTitle = storyData.metadata.title;

		// Make sure the metadata found in the story file will fit into the text fields in the edit metadata dialog.
		storyData.metadata.title = trimText(storyData.metadata.title, MAX_TITLE_LENGTH).trim();
		storyData.metadata.author = trimText(storyData.metadata.author, MAX_AUTHOR_LENGTH);
		storyData.metadata.teaser = trimText(storyData.metadata.teaser, MAX_TEASER_LENGTH);

		let storyId: string;
		try {
			// The story will be created, prefilled with metadata found in the story file.
			// Since there might have been none and we need at least a title to make it listable,
			// the story will be in draft state for now.
			storyId = await createStory(storyData.storyContent, storyData.metadata, ownerId, interaction.guildId);
		} catch (error) {
			logger.error(error, 'Error while trying to add story in guild %s.', interaction.guildId);
			await errorReply(interaction, t.user('reply.create-story-failure'));
			return;
		}

		let reply: InteractionReplyOptions;
		let inTesting = false;
		if (storyData.metadata.title && storyData.metadata.title === initialTitle) {
			// There was a title in the tags of the story file and we didn't have to alter it.
			// The story should therefore be ready to be published. We can forward it to Testing straight away!
			try {
				moveStoryToTesting(storyId, interaction.guildId);
				inTesting = true;
			} catch (error) {
				logger.error(error, 'Error while trying to move story %s to testing after creating it.', storyId);
				await errorReply(interaction, t.user('reply.create-story-failure'));
				return;
			}

			const storyEmbed = getDefaultStoryEmbed(storyData.metadata);
			const content =
				t.user('reply.story-test-created') +
				'\n' +
				t.user('reply.story-possible-actions-in-testing', {
					command: '/manage-stories show',
					guildId: interaction.guildId
				});
			reply = {
				content,
				embeds: [storyEmbed],
				components: getStoryButtonComponents(storyId, StoryStatus.Testing, t, interaction.guildId),
				ephemeral: true
			};
		} else {
			// Otherwise we should ask the user to complete / check the metadata first.
			// They will have to press a button to edit the metadata before they can publish it.
			// We could try showing the dialog for editing metadata straight away without asking the user to press a button.
			// But we would have to be sure that we're replying with the dialog within 3 seconds since dialogs can't be deferred.
			// But downloading and probing the story and writing it to disk might take longer than that, so not risking it.
			reply = {
				content: t.user('reply.story-draft-created'),
				components: [
					{
						type: ComponentType.ActionRow,
						components: [getEditMetadataButton(t, storyId)]
					}
				],
				ephemeral: true
			};
		}

		// loadStoryFromParameter might've sent a warning reply already.
		if (interaction.replied) {
			await interaction.followUp(reply);
		} else {
			await interaction.editReply(reply);
		}

		if (inTesting) {
			await updateCommandsAfterConfigChange(interaction, logger);
		}
	}
	// else we have to assume that the user was already replied to in loadStoryFromParameter.
}

async function createStory(storyContent: string, metadata: StoryMetadata, ownerId: string, guildId: string) {
	let attempts = 0;
	const initialTitle = metadata.title;
	while (attempts < 10) {
		try {
			// The story will be created, prefilled with metadata found in the story file.
			// Since there might have been none and we need at least a title to make it listable,
			// the story will be in draft state for now. The user will have to press a button to edit the metadata before they can publish it.
			return await addStory(storyContent, metadata, ownerId, guildId);
		} catch (error) {
			if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && metadata.title) {
				// The title found in the metadata already existed in the database (for this guild).
				// In an attempt to pick a unique title, we're shaving one more character off the end of the title and append a counter.
				metadata.title = trimText(initialTitle, MAX_TITLE_LENGTH - 1) + attempts;
				attempts++;
			} else {
				throw error;
			}
		}
	}
	// If it hasn't worked with other numbers yet, just ignore the title and create the story without it.
	metadata.title = '';
	return addStory(storyContent, metadata, ownerId, guildId);
}

async function loadStoryFromParameter(
	interaction: ChatInputCommandInteraction,
	required: boolean,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	const storyFileAttachment = interaction.options.getAttachment('ink-file', required);
	if (!required && !storyFileAttachment) {
		return null;
	}
	if (!isJsonFile(storyFileAttachment.contentType)) {
		// TODO later we will support compiling ink files as well.
		//  when compiling files we need to avoid INCLUDE statements. maybe strip them out first?
		await warningReply(
			interaction,
			t.user('reply.wrong-content-type', { providedType: storyFileAttachment.contentType })
		);
		return null;
	}
	if (storyFileAttachment.size > MAX_STORY_FILE_SIZE) {
		await warningReply(interaction, t.user('reply.file-too-large', { maxFileSize: MAX_STORY_FILE_SIZE }));
		return null;
	}

	let storyContent = '';
	try {
		const response = await axios.default.get(storyFileAttachment.url, {
			// Stop it from parsing the JSON, we want it as a string so we can store it.
			transformResponse: data => data
		});
		storyContent = response.data;
	} catch (error) {
		logger.error(error, 'Error while trying to fetch story file attachment.');
		await errorReply(interaction, t.user('reply.could-not-load-file'));
		return null;
	}
	let storyProbe: StoryProbe;
	try {
		storyProbe = probeStory(storyContent);
	} catch (error) {
		if (error.storyErrorType === StoryErrorType.TimeBudgetExceeded) {
			await errorReply(interaction, t.user('reply.time-budget-exceeded'));
			return null;
		}
		await errorReply(interaction, t.user('reply.story-errors', { errors: quote(error.message) }));
		return null;
	}
	if (storyProbe.stepData.errors?.length) {
		const errors = storyProbe.stepData.errors.map(error => quote(error)).join('\n');
		await errorReply(interaction, t.user('reply.story-errors', { errors }));
		return null;
	}
	if (storyProbe.stepData.warnings?.length) {
		const warnings = storyProbe.stepData.warnings.map(warning => quote(warning)).join('\n');
		await warningReply(interaction, t.user('reply.story-warnings', { warnings }));
	}

	return {
		storyContent,
		metadata: storyProbe.metadata
	};
}

function isJsonFile(contentType: string) {
	return contentType && (contentType === 'application/json' || contentType.startsWith('application/json;'));
}

async function handleEditStory(
	interaction: ChatInputCommandInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	// Downloading and testing the story and writing it to disk can take a while, so we defer the reply.
	await interaction.deferReply({ ephemeral: true });

	const storyId = interaction.options.getString('title', true);
	// We just want to make sure it exists before making any changes.
	// Otherwise we might be writing a file for a non-existing story.
	let story = null;
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

	let dataChanged = false;

	const storyData = await loadStoryFromParameter(interaction, false, t, logger);
	// If this was null, it could mean we either didn't get the parameter and so we don't need to do anything with it,
	// or there was an error and the client was already replied to.
	// When it's present though, we save the story.
	if (storyData) {
		try {
			replaceStoryContent(storyId, storyData.storyContent);
			stopStoryPlayAndInformPlayers(story, interaction.client, getStartStoryButtonId, logger);
			dataChanged = true;
		} catch (error) {
			logger.error(error, 'Error while trying to update file of story %s.', storyId);
			await errorReply(interaction, t.user('reply.edit-failure'));
			return;
		}
	}

	const owner = interaction.options.getUser('owner');
	if (owner && owner.id !== interaction.client.user.id && !owner.bot) {
		const ownerId = owner.id;
		try {
			changeStoryOwner(storyId, interaction.guildId, ownerId);
			dataChanged = true;
		} catch (error) {
			logger.error(error, 'Error while trying to change owner of story %s.', storyId);
			await errorReply(interaction, t.user('reply.edit-failure'));
			return;
		}
	}

	let replyText: string;
	let components: ActionRowData<MessageActionRowComponentBuilder>[];
	if (dataChanged) {
		replyText = t.user('reply.story-updated');
		components = getStoryButtonComponents(story.id, story.status, t, interaction.guildId);
	} else {
		replyText = t.user('reply.edit-metadata-prompt');
		components = [
			{
				type: ComponentType.ActionRow,
				components: [getEditMetadataButton(t, storyId, ButtonStyle.Primary)]
			}
		];
	}

	const reply = {
		content: replyText,
		components,
		ephemeral: true
	};
	// loadStoryFromParameter might've sent a warning reply already.
	if (interaction.replied) {
		await interaction.followUp(reply);
	} else {
		await interaction.editReply(reply);
	}
}

async function handleDeleteStory(
	interaction: MessageComponentInteraction,
	storyId: string,
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

	if (story) {
		if (story.status === StoryStatus.Published || story.status === StoryStatus.Unlisted) {
			// Deleting stories that have already been published is a bit more "catastrophic",
			// so to prevent user error, they don't get deleted straight away.
			// They just get made unavailable and the user can undo this.
			// After some time, they will be deleted completely.
			try {
				markStoryForDeletion(storyId, interaction.guildId);
			} catch (error) {
				logger.error(error, 'Error while trying to mark story %s for deletion.', storyId);
				await errorReply(interaction, t.user('reply.delete-failure'));
				return;
			}
			await disableButtons(interaction);
			await interaction.followUp({
				content: t.user('reply.marked-for-deletion-success'),
				components: [
					{
						type: ComponentType.ActionRow,
						components: [getUndoDeleteButton(t, storyId, story.status)]
					}
				],
				ephemeral: true
			});
		} else {
			try {
				deleteStory(storyId, interaction.guildId);
			} catch (error) {
				logger.error(error, 'Error while trying to delete story %s.', storyId);
				await errorReply(interaction, t.user('reply.delete-failure'));
				return;
			}
			await disableButtons(interaction);
			await t.privateReply(interaction, 'reply.delete-success');
		}

		await updateCommandsAfterConfigChange(interaction, logger);
	} else {
		await warningReply(interaction, t.userShared('story-not-found'));
	}
}

async function handleUndoDeleteStory(
	interaction: MessageComponentInteraction,
	storyId: string,
	previousStatusString: string,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	// TODO test (how? might have to put an invalid status in a button id)
	const previousStatus = enumFromStringValue(StoryStatus, previousStatusString);
	if (!previousStatus) {
		logger.warn("Invalid previous status '%s' received for undoing deletion of story %s.", previousStatus, storyId);
		await errorReply(interaction, t.user('reply.undo-delete-failure'));
		return;
	}

	let found: boolean;
	try {
		found = setStoryStatus(storyId, interaction.guildId, previousStatus, StoryStatus.ToBeDeleted);
	} catch (error) {
		logger.error(error, 'Error while trying to undo delete of story %s.', storyId);
		await errorReply(interaction, t.user('reply.undo-delete-failure'));
		return;
	}

	if (found) {
		await disableButtons(interaction);
		await t.privateReply(interaction, 'reply.undo-delete-success');
		await updateCommandsAfterConfigChange(interaction, logger);
	} else {
		await warningReply(interaction, t.userShared('story-not-found'));
	}
}

/**
 * The difference to "/story show" is that it will show stories that are not visible to others
 * (e.g. because they are unlisted or are in a testing status)
 * and that it will list more details about a story and show different actions.
 */
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

		await interaction.reply(getShowStoryMessage(story, interaction, t));
	} else {
		let guildStories: StoryRecord[] = [];
		try {
			guildStories = getStories(guildId, interaction.user.id, false);
		} catch (error) {
			logger.error(error, 'Error while trying to fetch stories in guild %s from database', guildId);
			await errorReply(interaction, t.userShared('show-stories-failure'));
			return;
		}
		if (guildStories.length) {
			const collator = new Intl.Collator(interaction.locale);
			const storyTitles = guildStories
				.map(story => {
					if (story.author) {
						return t.user('story-line', {
							title: story.title,
							author: story.author,
							status: t.user('story-status-' + story.status)
						});
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
								custom_id: getManageStoriesComponentId('show'),
								placeholder: t.userShared('show-story-details-select-label'),
								options
							}
						]
					}
				],
				ephemeral: true
			});
		} else {
			await t.privateReply(interaction, 'reply.no-stories-in-server');
		}
	}
}

function getShowStoryMessage(
	story: StoryRecord,
	interaction: ChatInputCommandInteraction | MessageComponentInteraction,
	t: ContextTranslatorFunctions
) {
	const storyEmbed = getDefaultStoryEmbed(story);
	storyEmbed.addFields([
		{ name: t.user('show-field-owner'), value: userMention(story.ownerId), inline: false },
		{ name: t.user('show-field-status'), value: t.user('story-status-' + story.status), inline: false }
	]);

	return {
		embeds: [storyEmbed],
		components: getStoryButtonComponents(story.id, story.status, t, interaction.guildId),
		ephemeral: true
	};
}

function getStoryButtonComponents(
	storyId: string,
	storyStatus: StoryStatus,
	t: ContextTranslatorFunctions,
	guildId: string
): ActionRowData<MessageActionRowComponentBuilder>[] {
	const editButtons = [getEditMetadataButton(t, storyId, ButtonStyle.Secondary)];
	const actionButtons: ButtonBuilder[] = [];
	if (storyStatus === StoryStatus.Testing) {
		actionButtons.push(getPlaytestButton(t, storyId, guildId));
		actionButtons.push(getPublishWizardButton(t, storyId));
	} else if (storyStatus === StoryStatus.Published || storyStatus === StoryStatus.Unlisted) {
		if (storyStatus === StoryStatus.Unlisted) {
			editButtons.push(getMakeListedButton(t, storyId));
		} else {
			editButtons.push(getMakeUnlistedButton(t, storyId));
		}
		actionButtons.push(getPostButton(t, storyId));
		actionButtons.push(getPostWithCustomMessageButton(t, storyId));
		// TODO later: "unpublish" button for moving a story back to testing? should stop current plays.
	}
	editButtons.push(getSuggestedStoryWizardButton(t, storyId));
	actionButtons.push(getDeleteButton(t, storyId));
	const components: ActionRowData<MessageActionRowComponentBuilder>[] = [
		{
			type: ComponentType.ActionRow,
			components: editButtons
		},
		{
			type: ComponentType.ActionRow,
			components: actionButtons
		}
	];
	return components;
}

function getEditMetadataButton(
	t: ContextTranslatorFunctions,
	storyId: string,
	style: InteractionButtonStyle = ButtonStyle.Primary
) {
	return getTranslatedConfigStoryButton(t, 'edit-metadata-button-label', 'edit-metadata ' + storyId, style);
}

function getUndoDeleteButton(t: ContextTranslatorFunctions, storyId: string, previousStatus: StoryStatus) {
	return getTranslatedConfigStoryButton(t, 'undo-delete-button-label', 'undo-delete ' + storyId + ' ' + previousStatus);
}

function getDeleteButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(t, 'delete-button-label', 'delete ' + storyId, ButtonStyle.Danger);
}

function getPublishWizardButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(
		t,
		'publish-wizard-button-label',
		'publish-wizard ' + storyId,
		ButtonStyle.Success
	);
}

function getPublishAndPostButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(
		t,
		'publish-and-post-button-label',
		'publish-and-post ' + storyId,
		ButtonStyle.Success
	);
}

function getPublishWithCustomMessageButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(
		t,
		'publish-with-custom-message-button-label',
		'publish-with-custom-message ' + storyId,
		ButtonStyle.Secondary
	);
}

function getPublishButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(t, 'publish-button-label', 'publish ' + storyId, ButtonStyle.Secondary);
}

function getPostButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(t, 'post-button-label', 'post ' + storyId, ButtonStyle.Secondary);
}

function getPostWithCustomMessageButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(
		t,
		'post-with-custom-message-button-label',
		'post-with-custom-message ' + storyId,
		ButtonStyle.Secondary
	);
}

function getMakeListedButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(t, 'make-listed-button-label', 'make-listed ' + storyId, ButtonStyle.Secondary);
}

function getMakeUnlistedButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(
		t,
		'make-unlisted-button-label',
		'make-unlisted ' + storyId,
		ButtonStyle.Secondary
	);
}

function getSuggestedStoryWizardButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(
		t,
		'suggested-story-wizard-button-label',
		'suggested-story-wizard ' + storyId,
		ButtonStyle.Secondary
	);
}

function getReturnToSuggestedStoryWizardButton(t: ContextTranslatorFunctions, storyId: string) {
	return getTranslatedConfigStoryButton(
		t,
		'return-to-suggested-story-wizard-button-label',
		'return-to-suggested-story-wizard ' + storyId,
		ButtonStyle.Secondary
	);
}

function getEditSuggestionButton(t: ContextTranslatorFunctions, storyId: string, suggestedStoryId: string) {
	return getTranslatedConfigStoryButton(
		t,
		'edit-story-suggestion-button-label',
		'edit-sug ' + storyId + ' ' + suggestedStoryId,
		ButtonStyle.Secondary
	);
}

function getDeleteSuggestionButton(t: ContextTranslatorFunctions, storyId: string, suggestedStoryId: string) {
	return getTranslatedConfigStoryButton(
		t,
		'delete-story-suggestion-button-label',
		'del-sug ' + storyId + ' ' + suggestedStoryId,
		ButtonStyle.Danger
	);
}

function getPlaytestButton(t: ContextTranslatorFunctions, storyId: string, guildId: string) {
	return new ButtonBuilder({
		type: ComponentType.Button,
		style: ButtonStyle.Secondary,
		label: t.user('playtest-button-label'),
		custom_id: getStartStoryButtonId(storyId, guildId)
	});
}

function getTranslatedConfigStoryButton(
	t: ContextTranslatorFunctions,
	translationKey: string,
	innerCustomId: string,
	style: InteractionButtonStyle = ButtonStyle.Primary
) {
	return getConfigStoryButton(t.user(translationKey), innerCustomId, style);
}

/**
 * A button that will route to this command when clicked.
 */
function getConfigStoryButton(
	label: string,
	innerCustomId: string,
	style: InteractionButtonStyle = ButtonStyle.Primary
) {
	return new ButtonBuilder({
		type: ComponentType.Button,
		style,
		label,
		custom_id: getManageStoriesComponentId(innerCustomId)
	});
}

function getManageStoriesComponentId(innerCustomId: string) {
	return getCustomIdForCommandRouting(manageStoriesCommand, innerCustomId);
}

function getStoryCommandTranslator(interaction: BaseInteraction, guildConfig: GuildConfiguration) {
	return getTranslatorForInteraction(interaction, storyCommand, guildConfig);
}

async function handleTriggerEditMetadataDialog(
	interaction: MessageComponentInteraction,
	storyId: string,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	let storyRecord: StoryRecord | null = null;
	try {
		storyRecord = getStory(storyId, interaction.guildId);
	} catch (e) {
		logger.error(e, 'Error while trying to fetch story %s from database', storyId);
		await errorReply(interaction, t.userShared('story-db-fetch-error'));
		return;
	}
	if (!storyRecord) {
		await warningReply(interaction, t.userShared('story-not-found'));
		return;
	}

	await showMetadataDialog(storyRecord, interaction, t);
}

async function showMetadataDialog(
	storyRecord: StoryRecord,
	interaction: MessageComponentInteraction,
	t: ContextTranslatorFunctions
) {
	const dialogId = getManageStoriesComponentId('metadata ' + storyRecord.id);
	const metadataDialog = new ModalBuilder().setCustomId(dialogId).setTitle(t.user('metadata-dialog-title'));

	const titleField = new TextInputBuilder()
		.setCustomId('metadata-dialog-title-field')
		.setLabel(t.user('metadata-dialog-title-field-label'))
		.setStyle(TextInputStyle.Short)
		.setRequired(true)
		.setMinLength(1)
		.setMaxLength(MAX_TITLE_LENGTH);
	if (storyRecord.title) {
		// If we set an empty value, Discord will complain that it's under the min length.
		titleField.setValue(storyRecord.title);
	}

	const authorField = new TextInputBuilder()
		.setCustomId('metadata-dialog-author-field')
		.setLabel(t.user('metadata-dialog-author-field-label'))
		.setValue(storyRecord.author)
		.setStyle(TextInputStyle.Short)
		.setRequired(false)
		.setMaxLength(MAX_AUTHOR_LENGTH);

	const teaserField = new TextInputBuilder()
		.setCustomId('metadata-dialog-teaser-field')
		.setLabel(t.user('metadata-dialog-teaser-field-label'))
		.setValue(storyRecord.teaser)
		.setStyle(TextInputStyle.Paragraph)
		.setRequired(false)
		.setMaxLength(MAX_TEASER_LENGTH);

	metadataDialog.addComponents(
		new ActionRowBuilder<TextInputBuilder>().addComponents(titleField),
		new ActionRowBuilder<TextInputBuilder>().addComponents(authorField),
		new ActionRowBuilder<TextInputBuilder>().addComponents(teaserField)
	);

	await interaction.showModal(metadataDialog);
}

async function handleMetadataDialogSubmit(
	storyId: string,
	interaction: ModalSubmitInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	const title = interaction.fields.getTextInputValue('metadata-dialog-title-field');
	const author = interaction.fields.getTextInputValue('metadata-dialog-author-field');
	const teaser = interaction.fields.getTextInputValue('metadata-dialog-teaser-field');

	if (!title) {
		// Shouldn't happen if the dialog considers that the field ist required.
		await errorReply(interaction, t.user('reply.edit-failure'));
		return;
	}

	let found: boolean;
	try {
		found = completeStoryMetadata(storyId, interaction.guildId, { title, author, teaser });
	} catch (error) {
		if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
			// We can't store the title since there's already another story with the same title.
			// So we can't forward the story to Testing yet either (if it was in Draft).
			// But we can at least store the rest of the metadata so that this is not lost when the user reopens the dialog.
			try {
				changeStoryMetadata(storyId, interaction.guildId, { author, teaser });
			} catch (error) {
				logger.error(error, 'Error while trying to edit metadata of story %s.', storyId);
			}
			await warningReply(interaction, t.user('reply.edit-failure-title-not-unique'));
		} else {
			logger.error(error, 'Error while trying to edit metadata of story %s.', storyId);
			await errorReply(interaction, t.user('reply.edit-failure'));
		}
		return;
	}

	if (found) {
		let storyRecord: StoryRecord;
		try {
			storyRecord = getStory(storyId, interaction.guildId);
		} catch (error) {
			logger.error(error, 'Error while trying to fetch story %s after editing its metadata.', storyId);
			await errorReply(interaction, t.user('reply.edit-failure'));
			return;
		}
		// We know the story exists, so we don't have to check for null.

		const storyEmbed = getDefaultStoryEmbed({ title, author, teaser });
		let content = t.user('reply.story-metadata-updated');
		if (storyRecord.status === StoryStatus.Testing) {
			content += '\n' + t.user('reply.story-possible-actions-in-testing');
		}
		if (interaction.isFromMessage()) {
			await interaction.update({
				content,
				embeds: [storyEmbed],
				components: getStoryButtonComponents(storyRecord.id, storyRecord.status, t, interaction.guildId)
			});
		}

		await updateCommandsAfterConfigChange(interaction, logger);
	} else {
		await warningReply(interaction, t.userShared('story-not-found'));
	}
}

/**
 * This receives both the initial button click to launch the publish wizard,
 * as well as updates to the wizard (when selecting values in the drop-downs).
 */
async function handleShowPublishStoryWizard(
	interaction: MessageComponentInteraction,
	storyId: string,
	updateField: string | null,
	t: ContextTranslatorFunctions
) {
	const { listed, channelToPostIn } = getPublishWizardSettingsFromMessage(interaction, updateField);

	const content = t.user('reply.publish-wizard-intro', {
		command1: '/story start',
		command2: '/manage-stories show',
		guildId: interaction.guildId
	});

	const embeds = [];
	if (listed) {
		embeds.push(
			new EmbedBuilder().setDescription(
				t.user('reply.publish-wizard-listed', {
					command: '/story start',
					guildId: interaction.guildId
				})
			)
		);
	} else {
		embeds.push(
			new EmbedBuilder().setDescription(
				t.user('reply.publish-wizard-unlisted', {
					command: '/story start',
					guildId: interaction.guildId
				})
			)
		);
	}
	if (channelToPostIn === interaction.channelId) {
		embeds.push(new EmbedBuilder().setDescription(t.user('reply.publish-wizard-this-channel')));
	} else {
		embeds.push(
			new EmbedBuilder().setDescription(t.user('reply.publish-wizard-channel-mention', { channel: channelToPostIn }))
		);
	}

	const listedSelect = [
		new StringSelectMenuBuilder()
			.setCustomId(getManageStoriesComponentId('publish-listed ' + storyId))
			.setOptions(
				new StringSelectMenuOptionBuilder()
					.setLabel(t.user('publish-wizard-listed-option-label'))
					.setValue('true')
					.setDefault(listed),
				new StringSelectMenuOptionBuilder()
					.setLabel(t.user('publish-wizard-unlisted-option-label'))
					.setValue('false')
					.setDefault(!listed)
			)
	];
	const channelSelect = [
		// Unfortunately we can't prefill channel selects with previous values yet, so we have to show the current state in the message instead.
		new ChannelSelectMenuBuilder()
			.setCustomId(getManageStoriesComponentId('publish-in-channel ' + storyId))
			.setPlaceholder(t.user('publish-wizard-post-where-placeholder'))
			.setChannelTypes(
				ChannelType.GuildText,
				ChannelType.GuildForum,
				ChannelType.GuildAnnouncement,
				ChannelType.PublicThread,
				ChannelType.PrivateThread,
				ChannelType.AnnouncementThread
			)
	];

	// TODO later: publish a story for everyone or selectively or set unlock triggers
	//  so stories become available to someone if they e.g. completed another story (or got a certain ending in it).

	const buttons = [
		getPublishAndPostButton(t, storyId),
		getPublishWithCustomMessageButton(t, storyId),
		getPublishButton(t, storyId)
	];

	if (updateField) {
		await interaction.update({
			content,
			embeds,
			components: [
				{
					type: ComponentType.ActionRow,
					components: listedSelect
				},
				{
					type: ComponentType.ActionRow,
					components: channelSelect
				},
				{
					type: ComponentType.ActionRow,
					components: buttons
				}
			]
		});
	} else {
		// Make sure previous message can't be interacted with anymore.
		await disableButtons(interaction);
		await interaction.followUp({
			content,
			embeds,
			components: [
				{
					type: ComponentType.ActionRow,
					components: listedSelect
				},
				{
					type: ComponentType.ActionRow,
					components: channelSelect
				},
				{
					type: ComponentType.ActionRow,
					components: buttons
				}
			],
			ephemeral: true
		});
	}
}

function getPublishWizardSettingsFromMessage(interaction: MessageComponentInteraction, updateField: string | null) {
	// Default values of these two settings
	let listed = true;
	let channelToPostIn = interaction.channelId;
	// User updates one field: Extract the value of the other from the message.
	if (updateField === 'publish-listed' && isStringSelectMenuInteraction(interaction) && interaction.values.length) {
		listed = interaction.values[0] === 'true';
		// We only receive the value of the field that changed. So we have to get the value of the other field in some other way somehow.
		// Unfortunately Discord does not provide a way. We could persist this in the database which seems like overkill for wizard data.
		// Or we could encode it in all the custom ids, but they don't provide enough space.
		// Instead, we try to extract it back from the message sent to the user.
		const channelIdFromMention = getChannelIdFromMention(interaction);
		if (channelIdFromMention) {
			channelToPostIn = channelIdFromMention;
		}
	} else if (
		updateField === 'publish-in-channel' &&
		isChannelSelectMenuInteraction(interaction) &&
		interaction.channels.size
	) {
		channelToPostIn = interaction.channels.first().id;
		// In this case we can get the value of the other field in a hacky way: We set it as the default value of the field so we can use that
		// setting to retrieve the value again.
		listed = getListedSettingFromMessage(interaction);
	}
	return { listed, channelToPostIn };
}

function getListedSettingFromMessage(
	interaction: MessageComponentInteraction | ModalMessageModalSubmitInteraction
): boolean {
	// TODO find component via id instead. traversal function in interaction-utils.
	const actionRows = interaction.message.components;
	if (actionRows?.length) {
		const firstRowComponents = actionRows[0].components;
		if (firstRowComponents?.length) {
			const firstComponentData = firstRowComponents[0].data;
			if (isStringSelectComponent(firstComponentData) && firstComponentData.options.length) {
				return firstComponentData.options[0].default === true;
			}
		}
	}
	return false;
}

function isStringSelectComponent(component: AnyComponent): component is APIStringSelectComponent {
	return (component as APIStringSelectComponent).options !== undefined;
}

function getChannelIdFromMention(interaction: MessageComponentInteraction | ModalMessageModalSubmitInteraction) {
	for (const embed of interaction.message.embeds) {
		const channelMatch = embed.description.match(CHANNEL_MENTION_PATTERN);
		if (channelMatch) {
			return channelMatch[1];
		}
	}
	return null;
}

async function handleTriggerCustomPostMessageDialog(
	interaction: MessageComponentInteraction,
	storyId: string,
	publish: boolean,
	t: ContextTranslatorFunctions
) {
	let commandPrefix = 'custom-message-post ';
	if (publish) {
		commandPrefix = 'publish-custom-message-post ';
	}
	const dialogId = getManageStoriesComponentId(commandPrefix + storyId);
	const customMessagePostDialog = new ModalBuilder()
		.setCustomId(dialogId)
		.setTitle(t.user('custom-message-post-dialog-title'));

	const customMessageField = new TextInputBuilder()
		.setCustomId('custom-message-post-dialog-field')
		.setLabel(t.user('custom-message-post-dialog-field-label'))
		.setStyle(TextInputStyle.Paragraph)
		.setRequired(false)
		.setMinLength(0)
		// Kinda arbitrary limit for the message.
		.setMaxLength(MAX_TEASER_LENGTH);

	customMessagePostDialog.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(customMessageField));

	await interaction.showModal(customMessagePostDialog);
}

async function handlePublishStory(
	interaction: MessageComponentInteraction | ModalMessageModalSubmitInteraction,
	storyId: string,
	post: boolean,
	t: ContextTranslatorFunctions,
	guildConfig: GuildConfiguration,
	logger: Logger
) {
	let found: boolean;
	try {
		if (getListedSettingFromMessage(interaction)) {
			found = publishStory(storyId, interaction.guildId);
		} else {
			found = publishStoryUnlisted(storyId, interaction.guildId);
		}
	} catch (error) {
		logger.error(error, 'Error while trying to publish story %s.', storyId);
		await errorReply(interaction, t.user('reply.publish-failure'));
		return;
	}

	if (found) {
		await disableButtons(interaction);
		if (post) {
			let customMessage = null;
			if (isModalSubmitInteraction(interaction)) {
				customMessage = interaction.fields.getTextInputValue('custom-message-post-dialog-field') ?? '';
			}
			const channelIdFromMention = getChannelIdFromMention(interaction);
			await postStory(storyId, customMessage, channelIdFromMention, interaction, guildConfig, logger);
		} else {
			await t.privateReply(interaction, 'reply.publish-success');
		}

		await updateCommandsAfterConfigChange(interaction, logger);
	} else {
		await warningReply(interaction, t.userShared('story-not-found'));
	}
}

async function handlePostStory(
	interaction: MessageComponentInteraction | ModalMessageModalSubmitInteraction,
	storyId: string,
	guildConfig: GuildConfiguration,
	logger: Logger
) {
	let customMessage = null;
	if (isModalSubmitInteraction(interaction)) {
		customMessage = interaction.fields.getTextInputValue('custom-message-post-dialog-field') ?? '';
	}
	await postStory(storyId, customMessage, null, interaction, guildConfig, logger);
}

async function handleChangeListedStatus(
	interaction: MessageComponentInteraction,
	storyId: string,
	makeListed: boolean,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	let found: boolean;
	try {
		if (makeListed) {
			found = setStoryStatus(storyId, interaction.guildId, StoryStatus.Published, StoryStatus.Unlisted);
		} else {
			found = setStoryStatus(storyId, interaction.guildId, StoryStatus.Unlisted, StoryStatus.Published);
		}
	} catch (error) {
		logger.error(error, 'Error while trying to change listed status of story %s.', storyId);
		await errorReply(interaction, t.user('reply.change-listed-status-failure'));
		return;
	}

	if (found) {
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

		await interaction.update(getShowStoryMessage(story, interaction, t));

		await updateCommandsAfterConfigChange(interaction, logger);
	} else {
		await warningReply(interaction, t.userShared('story-not-found'));
	}
}

async function handleShowSuggestedStoryWizard(
	interaction: MessageComponentInteraction,
	storyId: string,
	update: boolean,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	const guildId = interaction.guildId;
	let guildStories: StoryRecord[] = [];
	try {
		// This will also show stories in status "Testing". They can be configured as suggestions
		// but they won't be suggested to a player unless they can see them.
		guildStories = getStories(guildId, interaction.user.id, false);
	} catch (error) {
		logger.error(error, 'Error while trying to fetch stories in guild %s from database', guildId);
		await errorReply(interaction, t.userShared('show-stories-failure'));
		return;
	}
	if (guildStories.length === 0) {
		await t.privateReply(interaction, 'reply.no-stories-in-server');
		return;
	}

	let content = t.user('reply.suggested-story-wizard-intro');
	const embeds = [];
	const components = [];

	let suggestedStories: StoryRecord[] = [];
	try {
		suggestedStories = getSuggestedStories(storyId);
	} catch (error) {
		logger.error(error, 'Error while trying to fetch suggested stories in guild %s from database', guildId);
		await errorReply(interaction, t.userShared('show-stories-failure'));
		return;
	}
	const suggestedIds = new Set();
	let suggestedOptions = [];
	if (suggestedStories.length) {
		suggestedStories.forEach(story => {
			suggestedIds.add(story.id);
		});

		content += '\n' + t.user('reply.suggested-story-wizard-suggestions-exist');

		const collator = new Intl.Collator(interaction.locale);
		const storyTitles = suggestedStories
			.map(story => {
				if (story.author) {
					return t.user('story-line-short', {
						title: story.title,
						author: story.author
					});
				}
				return story.title;
			})
			.sort(collator.compare);
		const titlesText = storyTitles.join('\n');
		embeds.push(
			new EmbedBuilder().setTitle(t.user('suggested-story-wizard-suggestions-header')).setDescription(titlesText)
		);

		suggestedOptions = suggestedStories.map(story => ({
			label: story.title,
			value: story.id
		}));
	}

	const suggestionOptions = guildStories
		.filter(story => story.id !== storyId && !suggestedIds.has(story.id))
		.map(story => ({
			label: story.title,
			value: story.id
		}));
	components.push({
		type: ComponentType.ActionRow,
		components: [
			{
				type: ComponentType.StringSelect,
				custom_id: getManageStoriesComponentId('suggest-story ' + storyId),
				placeholder: t.user('suggest-story-select-label'),
				options: suggestionOptions
			}
		]
	});

	// If we ever go above 25 stories per server and add pagination, there should still be a limit of 25 suggested stories
	// per story so this doesn't need pagination as well. Otherwise it gets confusing.
	if (suggestedStories.length) {
		components.push({
			type: ComponentType.ActionRow,
			components: [
				{
					type: ComponentType.StringSelect,
					custom_id: getManageStoriesComponentId('select-story-suggestion ' + storyId),
					placeholder: t.user('story-suggestion-select-label'),
					options: suggestedOptions
				}
			]
		});
	}

	const message = {
		content,
		embeds,
		components,
		ephemeral: true
	};
	if (update) {
		await interaction.update(message);
	} else {
		await interaction.reply(message);
	}
}

async function handleSelectStoryToSuggest(
	interaction: MessageComponentInteraction,
	storyId: string,
	t: ContextTranslatorFunctions,
	guildConfig: GuildConfiguration,
	logger: Logger
) {
	let suggestedStoryId: string | null = null;
	if (isStringSelectMenuInteraction(interaction) && interaction.values.length) {
		suggestedStoryId = interaction.values[0];
	}
	if (!suggestedStoryId) {
		// Assertion failure, let interaction handling deal with it.
		throw new Error('No selected value found in select interaction.');
	}
	await handleTriggerSuggestStoryDialog(interaction, storyId, suggestedStoryId, t, guildConfig, logger);
}

async function handleTriggerSuggestStoryDialog(
	interaction: MessageComponentInteraction,
	storyId: string,
	suggestedStoryId: string,
	t: ContextTranslatorFunctions,
	guildConfig: GuildConfiguration,
	logger: Logger
) {
	let suggestion: StorySuggestion | null = null;
	try {
		suggestion = getStorySuggestion(storyId, suggestedStoryId, guildConfig.id);
	} catch (error) {
		logger.error(
			error,
			'Error while trying to fetch suggestion between stories %s and %s from database',
			storyId,
			suggestedStoryId
		);
		await errorReply(interaction, t.user('load-suggestion-failure'));
		return;
	}

	// Some custom ids have a shorter name so that both story ids fit into the 100 character custom id limit.
	// This is an unfortunate effect of choosing UUIDs for the story ids which are quite long.
	// In the future we might attempt replacing this with e.g. https://github.com/ai/nanoid to avoid further problems like that.
	const dialogId = getManageStoriesComponentId('save-sug ' + storyId + ' ' + suggestedStoryId);
	const suggestStoryDialog = new ModalBuilder().setCustomId(dialogId).setTitle(t.user('suggest-story-dialog-title'));

	const messageField = new TextInputBuilder()
		.setCustomId('suggest-story-dialog-message-field')
		.setLabel(t.user('suggest-story-dialog-message-field-label'))
		.setStyle(TextInputStyle.Paragraph)
		.setRequired(false)
		.setMinLength(0)
		// Kinda arbitrary limit for the message.
		.setMaxLength(MAX_TEASER_LENGTH);
	if (suggestion?.message) {
		messageField.setValue(suggestion.message);
	}

	// Later: Optional single-line text field for an unlock id needed to make this suggestion trigger.

	suggestStoryDialog.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(messageField));

	await interaction.showModal(suggestStoryDialog);
}

async function handleSuggestStoryDialogSubmit(
	interaction: ModalMessageModalSubmitInteraction,
	storyId: string,
	suggestedStoryId: string,
	t: ContextTranslatorFunctions,
	guildConfig: GuildConfiguration,
	logger: Logger
) {
	const message = interaction.fields.getTextInputValue('suggest-story-dialog-message-field') ?? '';
	try {
		addOrEditStorySuggestion(storyId, suggestedStoryId, guildConfig.id, message);
	} catch (error) {
		logger.error(
			error,
			'Error while trying to store a suggestion link between stories %s and %s.',
			storyId,
			suggestedStoryId
		);
		await errorReply(interaction, t.user('reply.save-suggestion-failure'));
		return;
	}

	await showStorySuggestion(interaction, storyId, suggestedStoryId, t, guildConfig, logger);
}

async function handleSelectStorySuggestionForEditing(
	interaction: MessageComponentInteraction,
	storyId: string,
	t: ContextTranslatorFunctions,
	guildConfig: GuildConfiguration,
	logger: Logger
) {
	let suggestedStoryId: string | null = null;
	if (isStringSelectMenuInteraction(interaction) && interaction.values.length) {
		suggestedStoryId = interaction.values[0];
	}
	if (!suggestedStoryId) {
		// Assertion failure, let interaction handling deal with it.
		throw new Error('No selected value found in select interaction.');
	}

	await showStorySuggestion(interaction, storyId, suggestedStoryId, t, guildConfig, logger);
}

async function showStorySuggestion(
	interaction: MessageComponentInteraction | ModalMessageModalSubmitInteraction,
	storyId: string,
	suggestedStoryId: string,
	t: ContextTranslatorFunctions,
	guildConfig: GuildConfiguration,
	logger: Logger
) {
	let suggestion: StorySuggestion | null = null;
	let suggestedStory: StoryRecord | null = null;
	try {
		suggestion = getStorySuggestion(storyId, suggestedStoryId, guildConfig.id);
		suggestedStory = getStory(suggestedStoryId, guildConfig.id);
	} catch (error) {
		logger.error(error, 'Error while trying to fetch story %s or story suggestion from database', storyId);
		await errorReply(interaction, t.userShared('story-db-fetch-error'));
		return;
	}
	if (suggestion === null || suggestedStory === null) {
		await warningReply(interaction, t.userShared('story-not-found'));
		return;
	}

	// Later: show the unlock id.
	const content = t.user('reply.suggestion-saved-message');

	const storyT = getStoryCommandTranslator(interaction, guildConfig);
	const messageEmbed = getSuggestionEmbed(suggestion, storyT);
	const storyEmbed = getDefaultStoryEmbed(suggestedStory);

	const buttons = [
		getEditSuggestionButton(t, storyId, suggestedStoryId),
		getDeleteSuggestionButton(t, storyId, suggestedStoryId),
		getReturnToSuggestedStoryWizardButton(t, storyId)
	];

	await interaction.update({
		content,
		embeds: [messageEmbed, storyEmbed],
		components: [
			{
				type: ComponentType.ActionRow,
				components: buttons
			}
		]
	});
}

async function handleDeleteSuggestion(
	interaction: MessageComponentInteraction,
	storyId: string,
	suggestedStoryId: string,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	try {
		deleteStorySuggestion(storyId, suggestedStoryId);
	} catch (error) {
		logger.error(
			error,
			'Error while trying to delete a suggestion link between stories %s and %s.',
			storyId,
			suggestedStoryId
		);
		await errorReply(interaction, t.user('reply.delete-suggestion-failure'));
		return;
	}

	// Success - go back to list.
	await handleShowSuggestedStoryWizard(interaction, storyId, true, t, logger);
}

export default manageStoriesCommand;
