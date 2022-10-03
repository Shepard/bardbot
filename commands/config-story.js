import { Constants, Permissions, Modal, MessageActionRow, TextInputComponent, MessageEmbed } from 'discord.js';
import { quote, userMention } from '@discordjs/builders';
import axios from 'axios';
import {
	addStory,
	getNumberOfStories,
	replaceStoryContent,
	getStory,
	getStories,
	findMatchingStories,
	changeStoryMetadata,
	completeStoryMetadata,
	changeStoryEditor,
	moveStoryToTesting,
	publishStory,
	markStoryForDeletion,
	setStoryStatus,
	deleteStory,
	StoryStatus
} from '../storage/story-dao.js';
import {
	AUTOCOMPLETE_CHOICE_LIMIT,
	COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT,
	SELECT_CHOICE_LIMIT
} from '../util/discord-constants.js';
import { getCustomIdForCommandRouting, errorReply, warningReply, disableButtons } from '../util/interaction-util.js';
import { probeStory, StoryErrorType, stopStoryPlayAndInformPlayers } from '../story/story-engine.js';
import { postStory, getStartStoryButtonId, getDefaultStoryEmbed } from './story.js';
import { trimText } from '../util/helpers.js';
import { updateCommandsAfterConfigChange } from './config.js';

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

const configStoryCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'config-story',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		defaultMemberPermissions: new Permissions([Permissions.FLAGS.MANAGE_GUILD]),
		options: [
			{
				name: 'create',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'ink-file',
						type: Constants.ApplicationCommandOptionTypes.ATTACHMENT,
						required: true
					},
					{
						name: 'editor',
						type: Constants.ApplicationCommandOptionTypes.USER,
						required: false
					}
				]
			},
			{
				name: 'edit',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'title',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						autocomplete: true,
						max_length: COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT
					},
					{
						name: 'ink-file',
						type: Constants.ApplicationCommandOptionTypes.ATTACHMENT,
						required: false
					},
					{
						name: 'editor',
						type: Constants.ApplicationCommandOptionTypes.USER,
						required: false
					}
				]
			},
			{
				name: 'show',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'title',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false,
						autocomplete: true,
						max_length: COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT
					}
				]
			}
		]
	},
	// Handler for when the command is used
	async execute(interaction, { t, logger }) {
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'create') {
			await handleCreateStory(interaction, t, logger);
		} else if (subcommand === 'edit') {
			await handleEditStory(interaction, t, logger);
		} else if (subcommand === 'show') {
			await handleShowStories(interaction, t, logger);
		} else {
			await t.privateReplyShared(interaction, 'unknown-command');
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
			result = result.sort((a, b) => collator.compare(a?.title, b?.title));
			return result;
		} else {
			return [];
		}
	},
	async modalInteraction(interaction, innerCustomId, { t, logger }) {
		if (innerCustomId.startsWith('metadata ')) {
			const storyId = innerCustomId.substring('metadata '.length);
			await handleMetadataDialogSubmit(storyId, interaction, t, logger);
		} else {
			await t.privateReplyShared(interaction, 'unknown-command');
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
		} else if (innerCustomId.startsWith('publish ')) {
			const storyId = innerCustomId.substring('publish '.length);
			await handlePublishStory(interaction, storyId, t, guildConfig, logger);
		} else if (innerCustomId.startsWith('show')) {
			await handleShowStories(interaction, t, logger);
		} else {
			await t.privateReplyShared(interaction, 'unknown-command');
		}
	}
};

async function handleCreateStory(interaction, t, logger) {
	const numStories = getNumberOfStories(interaction.guildId, logger, true);
	if (numStories + 1 > MAX_STORIES_PER_GUILD) {
		await warningReply(interaction, t.user('reply.max-stories-reached'));
		return null;
	}

	// Downloading and testing the story and writing it to disk can take a while, so we defer the reply to get more time to reply.
	await interaction.deferReply({ ephemeral: true });

	const storyData = await loadStoryFromParameter(interaction, true, t, logger);
	if (storyData) {
		const editor = interaction.options.getUser('editor');
		// If no editor is supplied or we can't accept the selected user, default to the user who uploaded the story.
		let editorId = interaction.user.id;
		// We don't allow picking the bot itself or any other bot (cause we can't DM those) as the editor.
		if (editor && editor.id !== interaction.client.user.id && !editor.bot) {
			editorId = editor.id;
		}

		const initialTitle = storyData.metadata.title;

		// Make sure the metadata found in the story file will fit into the text fields in the edit metadata dialog.
		storyData.metadata.title = trimText(storyData.metadata.title, MAX_TITLE_LENGTH).trim();
		storyData.metadata.author = trimText(storyData.metadata.author, MAX_AUTHOR_LENGTH);
		storyData.metadata.teaser = trimText(storyData.metadata.teaser, MAX_TEASER_LENGTH);

		let storyId;
		try {
			// The story will be created, prefilled with metadata found in the story file.
			// Since there might have been none and we need at least a title to make it listable,
			// the story will be in draft state for now.
			storyId = await createStory(storyData, editorId, interaction.guildId);
		} catch (error) {
			logger.error(error, 'Error while trying to add story in guild %s.', interaction.guildId);
			await errorReply(interaction, t.user('reply.create-story-failure'));
			return;
		}

		let reply;
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
			let content = t.user('reply.story-test-created') + '\n' + t.user('reply.story-possible-actions-in-testing');
			const buttons = [
				getEditMetadataButton(t, storyId, Constants.MessageButtonStyles.SECONDARY),
				getPlaytestButton(t, storyId, interaction.guildId),
				getPublishButton(t, storyId)
			];
			reply = {
				content,
				embeds: [storyEmbed],
				components: [
					{
						type: Constants.MessageComponentTypes.ACTION_ROW,
						components: buttons
					}
				],
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
						type: Constants.MessageComponentTypes.ACTION_ROW,
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
			await updateCommandsAfterConfigChange(interaction, t, logger);
		}
	}
	// else we have to assume that the user was already replied to in loadStoryFromParameter.
}

async function createStory(storyData, editorId, guildId) {
	let attempts = 0;
	const initialTitle = storyData.metadata.title;
	while (attempts < 10) {
		try {
			// The story will be created, prefilled with metadata found in the story file.
			// Since there might have been none and we need at least a title to make it listable,
			// the story will be in draft state for now. The user will have to press a button to edit the metadata before they can publish it.
			return await addStory(storyData.storyContent, storyData.metadata, editorId, guildId);
		} catch (error) {
			if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && storyData.metadata.title) {
				// The title found in the metadata already existed in the database (for this guild).
				// In an attempt to pick a unique title, we're shaving one more character off the end of the title and append a counter.
				storyData.metadata.title = trimText(initialTitle, MAX_TITLE_LENGTH - 1) + attempts;
				attempts++;
			} else {
				throw error;
			}
		}
	}
	// If it hasn't worked with other numbers yet, just ignore the title and create the story without it.
	storyData.metadata.title = '';
	return addStory(storyData.storyContent, storyData.metadata, editorId, guildId);
}

async function loadStoryFromParameter(interaction, required, t, logger) {
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
		const response = await axios.get(storyFileAttachment.url, {
			// Stop it from parsing the JSON, we want it as a string so we can store it.
			transformResponse: data => data
		});
		storyContent = response.data;
	} catch (error) {
		logger.error(error, 'Error while trying to fetch story file attachment.');
		await errorReply(interaction, t.user('reply.could-not-load-file'));
		return null;
	}
	let stepData;
	try {
		stepData = probeStory(storyContent);
	} catch (error) {
		if (error.storyErrorType === StoryErrorType.TimeBudgetExceeded) {
			await errorReply(interaction, t.user('reply.time-budget-exceeded'));
			return null;
		}
		await errorReply(interaction, t.user('reply.story-errors', { errors: quote(error.message) }));
		return null;
	}
	if (stepData.errors?.length) {
		const errors = stepData.errors.map(error => quote(error)).join('\n');
		await errorReply(interaction, t.user('reply.story-errors', { errors }));
		return null;
	}
	if (stepData.warnings?.length) {
		const warnings = stepData.warnings.map(warning => quote(warning)).join('\n');
		await warningReply(interaction, t.user('reply.story-warnings', { warnings }));
	}

	return {
		storyContent,
		metadata: stepData.metadata
	};
}

function isJsonFile(contentType) {
	return contentType === 'application/json' || contentType.startsWith('application/json;');
}

async function handleEditStory(interaction, t, logger) {
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

	const editor = interaction.options.getUser('editor');
	if (editor && editor.id !== interaction.client.user.id && !editor.bot) {
		const editorId = editor.id;
		try {
			changeStoryEditor(storyId, interaction.guildId, editorId);
			dataChanged = true;
		} catch (error) {
			logger.error(error, 'Error while trying to change editor of story %s.', storyId);
			await errorReply(interaction, t.user('reply.edit-failure'));
			return;
		}
	}

	let replyText;
	if (dataChanged) {
		replyText = t.user('reply.story-updated');
	} else {
		replyText = t.user('reply.edit-metadata-prompt');
	}
	const reply = {
		content: replyText,
		components: [
			{
				type: Constants.MessageComponentTypes.ACTION_ROW,
				components: [
					getEditMetadataButton(
						t,
						storyId,
						dataChanged ? Constants.MessageButtonStyles.SECONDARY : Constants.MessageButtonStyles.PRIMARY
					)
				]
			}
		],
		ephemeral: true
	};
	// loadStoryFromParameter might've sent a warning reply already.
	if (interaction.replied) {
		await interaction.followUp(reply);
	} else {
		await interaction.editReply(reply);
	}
}

async function handleDeleteStory(interaction, storyId, t, logger) {
	let story = null;
	try {
		story = getStory(storyId, interaction.guildId);
	} catch (error) {
		logger.error(error, 'Error while trying to fetch story %s from database', storyId);
		await errorReply(interaction, t.userShared('story-db-fetch-error'));
		return;
	}

	if (story) {
		if (story.status === StoryStatus.Published) {
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
						type: Constants.MessageComponentTypes.ACTION_ROW,
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

		await updateCommandsAfterConfigChange(interaction, t, logger);
	} else {
		await warningReply(interaction, t.userShared('story-not-found'));
	}
}

async function handleUndoDeleteStory(interaction, storyId, previousStatus, t, logger) {
	if (StoryStatus[previousStatus] !== previousStatus) {
		logger.warn("Invalid previous status '%s' received for undoing deletion of story %s.", previousStatus, storyId);
		await errorReply(interaction, t.user('reply.undo-delete-failure'));
		return;
	}

	let found;
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
		await updateCommandsAfterConfigChange(interaction, t, logger);
	} else {
		await warningReply(interaction, t.userShared('story-not-found'));
	}
}

/**
 * The difference to "/story show" is that it will show stories that are not visible to others
 * (e.g. because they have unlock triggers or are in a testing status)
 * and that it will list more details about a story and show different actions.
 */
async function handleShowStories(interaction, t, logger) {
	const guildId = interaction.guildId;
	let storyId;
	if (
		interaction.componentType === Constants.MessageComponentTypes[Constants.MessageComponentTypes.SELECT_MENU] &&
		interaction.values?.length
	) {
		storyId = interaction.values[0];
	} else {
		storyId = interaction.options?.getString('title');
	}

	if (storyId) {
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

		const storyEmbed = getDefaultStoryEmbed(story);
		storyEmbed.addFields([
			{ name: t.user('show-field-editor'), value: userMention(story.editorId), inline: false },
			{ name: t.user('show-field-status'), value: t.user('story-status-' + story.status), inline: false }
		]);
		const buttons = [getEditMetadataButton(t, storyId, Constants.MessageButtonStyles.SECONDARY)];
		if (story.status === StoryStatus.Testing) {
			buttons.push(getPlaytestButton(t, storyId, interaction.guildId));
			buttons.push(getPublishButton(t, storyId));
		} else if (story.status === StoryStatus.Published) {
			// TODO later: "unpublish" button for moving a story back to testing? should stop current plays.
		}
		buttons.push(getDeleteButton(t, storyId));
		const components = [
			{
				type: Constants.MessageComponentTypes.ACTION_ROW,
				components: buttons
			}
		];
		await interaction.reply({
			embeds: [storyEmbed],
			components,
			ephemeral: true
		});
	} else {
		let guildStories = null;
		try {
			guildStories = getStories(guildId, interaction.user.id, false);
		} catch (error) {
			logger.error(error, 'Error while trying to fetch stories in guild %s from database', guildId);
			await t.privateReplyShared(interaction, 'show-stories-failure');
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
				embeds: [new MessageEmbed().setTitle(embedTitle).setDescription(titlesText)],
				components: [
					{
						type: Constants.MessageComponentTypes.ACTION_ROW,
						components: [
							{
								type: Constants.MessageComponentTypes.SELECT_MENU,
								custom_id: getConfigStoryComponentId('show'),
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

function getEditMetadataButton(t, storyId, style) {
	return getTranslatedConfigStoryButton(t, 'edit-metadata-button-label', 'edit-metadata ' + storyId, style);
}

function getUndoDeleteButton(t, storyId, previousStatus) {
	return getTranslatedConfigStoryButton(t, 'undo-delete-button-label', 'undo-delete ' + storyId + ' ' + previousStatus);
}

function getDeleteButton(t, storyId) {
	return getTranslatedConfigStoryButton(
		t,
		'delete-button-label',
		'delete ' + storyId,
		Constants.MessageButtonStyles.DANGER
	);
}

function getPublishButton(t, storyId) {
	return getTranslatedConfigStoryButton(
		t,
		'publish-button-label',
		'publish ' + storyId,
		Constants.MessageButtonStyles.SUCCESS
	);
}

function getPlaytestButton(t, storyId, guildId) {
	return {
		type: Constants.MessageComponentTypes.BUTTON,
		style: Constants.MessageButtonStyles.SECONDARY,
		label: t.user('playtest-button-label'),
		custom_id: getStartStoryButtonId(storyId, guildId)
	};
}

function getTranslatedConfigStoryButton(t, translationKey, innerCustomId, style) {
	return getConfigStoryButton(t.user(translationKey), innerCustomId, style);
}

/**
 * A button that will route to this command when clicked.
 */
function getConfigStoryButton(label, innerCustomId, style) {
	return {
		type: Constants.MessageComponentTypes.BUTTON,
		style: style ?? Constants.MessageButtonStyles.PRIMARY,
		label,
		custom_id: getConfigStoryComponentId(innerCustomId)
	};
}

function getConfigStoryComponentId(innerCustomId) {
	return getCustomIdForCommandRouting(configStoryCommand, innerCustomId);
}

async function handleTriggerEditMetadataDialog(interaction, storyId, t, logger) {
	let storyRecord = null;
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

async function showMetadataDialog(storyRecord, interaction, t) {
	const dialogId = getCustomIdForCommandRouting(configStoryCommand, 'metadata ' + storyRecord.id);
	const metadataDialog = new Modal().setCustomId(dialogId).setTitle(t.user('metadata-dialog-title'));

	const titleField = new TextInputComponent()
		.setCustomId('metadata-dialog-title-field')
		.setLabel(t.user('metadata-dialog-title-field-label'))
		.setValue(storyRecord.title)
		.setStyle(Constants.TextInputStyles[Constants.TextInputStyles.SHORT])
		.setRequired(true)
		.setMinLength(1)
		.setMaxLength(MAX_TITLE_LENGTH);

	const authorField = new TextInputComponent()
		.setCustomId('metadata-dialog-author-field')
		.setLabel(t.user('metadata-dialog-author-field-label'))
		.setValue(storyRecord.author)
		.setStyle(Constants.TextInputStyles[Constants.TextInputStyles.SHORT])
		.setRequired(false)
		.setMaxLength(MAX_AUTHOR_LENGTH);

	const teaserField = new TextInputComponent()
		.setCustomId('metadata-dialog-teaser-field')
		.setLabel(t.user('metadata-dialog-teaser-field-label'))
		.setValue(storyRecord.teaser)
		.setStyle(Constants.TextInputStyles[Constants.TextInputStyles.PARAGRAPH])
		.setRequired(false)
		.setMaxLength(MAX_TEASER_LENGTH);

	metadataDialog.addComponents(
		new MessageActionRow().addComponents(titleField),
		new MessageActionRow().addComponents(authorField),
		new MessageActionRow().addComponents(teaserField)
	);

	await interaction.showModal(metadataDialog);
}

async function handleMetadataDialogSubmit(storyId, interaction, t, logger) {
	const title = interaction.fields.getTextInputValue('metadata-dialog-title-field');
	const author = interaction.fields.getTextInputValue('metadata-dialog-author-field');
	const teaser = interaction.fields.getTextInputValue('metadata-dialog-teaser-field');

	if (!title) {
		// Shouldn't happen if the dialog considers that the field ist required.
		await errorReply(interaction, t.user('reply.edit-failure'));
		return;
	}

	let found;
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
		let storyRecord;
		try {
			storyRecord = getStory(storyId, interaction.guildId);
		} catch (error) {
			logger.error(error, 'Error while trying to fetch story %s after editing its metadata.', storyId);
			await errorReply(interaction, t.user('reply.edit-failure'));
			return;
		}
		const storyEmbed = getDefaultStoryEmbed({ title, author, teaser });
		let content = t.user('reply.story-metadata-updated');
		const buttons = [getEditMetadataButton(t, storyId, Constants.MessageButtonStyles.SECONDARY)];
		if (storyRecord.status === StoryStatus.Testing) {
			content += '\n' + t.user('reply.story-possible-actions-in-testing');
			buttons.push(getPlaytestButton(t, storyId, interaction.guildId));
			buttons.push(getPublishButton(t, storyId));
		}
		await interaction.update({
			content,
			embeds: [storyEmbed],
			components: [
				{
					type: Constants.MessageComponentTypes.ACTION_ROW,
					components: buttons
				}
			],
			ephemeral: true
		});

		await updateCommandsAfterConfigChange(interaction, t, logger);
	} else {
		await warningReply(interaction, t.userShared('story-not-found'));
	}
}

async function handlePublishStory(interaction, storyId, t, guildConfig, logger) {
	let found;
	try {
		found = publishStory(storyId, interaction.guildId);
	} catch (error) {
		logger.error(error, 'Error while trying to publish story %s.', storyId);
		await errorReply(interaction, t.user('reply.publish-failure'));
		return;
	}

	if (found) {
		await disableButtons(interaction);
		await postStory(storyId, true, interaction, guildConfig, logger);

		await updateCommandsAfterConfigChange(interaction, t, logger);
	} else {
		await warningReply(interaction, t.userShared('story-not-found'));
	}

	// TODO later: via config commands you can publish a story for everyone or selectively or you can set unlock triggers
	//  so stories become available to someone if they e.g. completed another story (or got a certain ending in it).
}

export default configStoryCommand;
