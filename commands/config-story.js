import { Constants, Permissions, Modal, MessageActionRow, TextInputComponent, MessageEmbed } from 'discord.js';
import { quote, userMention } from '@discordjs/builders';
import axios from 'axios';
import {
	addStory,
	replaceStoryContent,
	getStory,
	getStories,
	findMatchingStories,
	changeStoryMetadata,
	changeStoryEditor,
	publishStory,
	StoryStatus
} from '../storage/story-dao.js';
import { AUTOCOMPLETE_CHOICE_LIMIT, COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT } from '../util/discord-constants.js';
import {
	getCustomIdForCommandRouting,
	errorReply,
	warningReply,
	disableButtons,
	sendListReply
} from '../util/interaction-util.js';
import { probeStory, StoryErrorType, resetStoryPlayStateAndInformPlayers } from '../story/story-engine.js';
import { postStory } from './story.js';
import { trimText } from '../util/helpers.js';

// TODO check that all log statements contain enough context

const MAX_STORY_FILE_SIZE = 1000000;
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
			/*{
				name: 'delete',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'title',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						autocomplete: true,
						max_length: COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT
					}
				]
			},*/
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
			},
			{
				name: 'post',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'title',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						autocomplete: true,
						max_length: COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT
					}
				]
			}
		]
	},
	// Handler for when the command is used
	async execute(interaction, { t, logger, guildConfig }) {
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'create') {
			await handleCreateStory(interaction, t, logger);
		} else if (subcommand === 'edit') {
			await handleEditStory(interaction, t, logger);
			//} else if (subcommand === 'delete') {
			//	await handleDeleteStory(interaction, t, logger);
		} else if (subcommand === 'show') {
			await handleShowStories(interaction, t, logger);
		} else if (subcommand === 'post') {
			await handlePostStory(interaction, t, logger, guildConfig);
		} else {
			await t.privateReplyShared(interaction, 'unknown-command');
		}
	},
	async autocomplete(interaction, { logger }) {
		const focusedOption = interaction.options.getFocused(true);
		if (focusedOption.name === 'title') {
			const matchingStories = findMatchingStories(interaction.guildId, focusedOption.value, logger, false);
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
	async componentInteraction(interaction, innerCustomId, { t, logger }) {
		if (innerCustomId.startsWith('edit-metadata ')) {
			const storyId = innerCustomId.substring('edit-metadata '.length);
			await handleTriggerEditMetadataDialog(interaction, storyId, t, logger);
		} else if (innerCustomId.startsWith('publish ')) {
			const storyId = innerCustomId.substring('publish '.length);
			await handlePublishStory(interaction, storyId, t, logger);
		} else {
			await t.privateReplyShared(interaction, 'unknown-command');
		}
	}
};

async function handleCreateStory(interaction, t, logger) {
	// TODO later: limit the number of stories allowed for a guild (to prevent malicious guilds from filling up the HD),
	//  including drafts, testing, published, excluding to-be-deleted stories.

	// Downloading and testing the story and writing it to disk can take a while, so we defer the reply to get more time to reply.
	await interaction.deferReply({ ephemeral: true });

	const storyData = await loadStoryFromParameter(interaction, true, t);
	if (storyData) {
		// If no editor is supplied, default to the user who uploaded the story.
		let editorId = interaction.options.getUser('editor')?.id ?? interaction.user.id;
		// We don't allow picking the bot itself as the editor. In this case we just silently default to the current user as well.
		if (editorId === interaction.client.user.id) {
			editorId = interaction.user.id;
		}

		// Make sure the metadata found in the story file will fit into the text fields in the edit metadata dialog.
		storyData.metadata.title = trimText(storyData.metadata.title, MAX_TITLE_LENGTH);
		storyData.metadata.author = trimText(storyData.metadata.author, MAX_AUTHOR_LENGTH);
		storyData.metadata.teaser = trimText(storyData.metadata.teaser, MAX_TEASER_LENGTH);

		let storyId;
		try {
			// The story will be created, prefilled with metadata found in the story file.
			// Since there might have been none and we need at least a title to make it listable,
			// the story will be in draft state for now. The user will have to press a button to edit the metadata before they can publish it.
			storyId = await createStory(storyData, editorId, interaction.guildId);
		} catch (error) {
			logger.error(error, 'Error while trying to add story.');
			await errorReply(interaction, t.user('reply.create-story-failure'));
			return;
		}

		// We could try showing the dialog for editing metadata straight away without asking the user to press a button.
		// But we would have to be sure that we're replying with the dialog within 3 seconds since dialogs can't be deferred.
		// But downloading and probing the story and writing it to disk might take longer than that, so not risking it.

		// TODO if the title was successfully set, we could change the reply a bit and already show the story embed and a publish button.
		const reply = {
			content: t.user('reply.story-draft-created'),
			components: [
				{
					type: Constants.MessageComponentTypes.ACTION_ROW,
					components: [getEditMetadataButton(t, storyId)]
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

async function loadStoryFromParameter(interaction, required, t) {
	const storyFileAttachment = interaction.options.getAttachment('ink-file', required);
	if (!required && !storyFileAttachment) {
		return null;
	}
	if (!isJsonFile(storyFileAttachment.contentType)) {
		// TODO later we will support compiling ink files as well.
		//  when compiling files we need to avoid INCLUDE statements. maybe strip them out first?
		await errorReply(
			interaction,
			t.user('reply.wrong-content-type', { providedType: storyFileAttachment.contentType })
		);
		return null;
	}
	if (storyFileAttachment.size > MAX_STORY_FILE_SIZE) {
		await errorReply(interaction, t.user('reply.file-too-large', { maxFileSize: MAX_STORY_FILE_SIZE }));
		return null;
	}

	let storyContent = '';
	try {
		// TODO check response code. we can validate statuses: https://github.com/axios/axios#handling-errors
		const response = await axios.get(storyFileAttachment.url, {
			// Stop it from parsing the JSON, we want it as a string so we can store it.
			transformResponse: data => data
		});
		storyContent = response.data;
	} catch (error) {
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
		await t.privateReply(interaction, 'reply.story-warnings', { warnings });
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

	let dataChanged = false;

	const storyData = await loadStoryFromParameter(interaction, false, t);
	// If this was null, it could mean we either didn't get the parameter and so we don't need to do anything with it,
	// or there was an error and the client was already replied to.
	// When it's present though, we save the story.
	if (storyData) {
		try {
			replaceStoryContent(storyId, storyData.storyContent);
			resetStoryPlayStateAndInformPlayers(story, interaction.client, logger);
			dataChanged = true;
		} catch (error) {
			logger.error(error, 'Error while trying to update file of story.');
			await errorReply(interaction, t.user('reply.edit-failure'));
			return;
		}
	}

	const editorId = interaction.options.getUser('editor')?.id;
	if (editorId && editorId !== interaction.client.user.id) {
		try {
			changeStoryEditor(storyId, editorId);
			dataChanged = true;
		} catch (error) {
			logger.error(error, 'Error while trying to change editor of story.');
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
				components: [getEditMetadataButton(t, storyId)]
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

/*async function handleDeleteStory(interaction, t, logger) {
	// TODO later: implement
	//  deleting a story will delete all current and past plays of it from players.
	//  do I want to request confirmation first?
	//  or maybe put the story into a ToBeDeleted status, provide an undo button in the success message, and only clean up ToBeDeleted stories after a while.
	//  ToBeDeleted stories don't show up in any list.
	//  need to decide if this would still interrupt a user's play of the story.
	await interaction.reply({
		content: 'Deleting stories has not been implemented yet. *shrug*',
		ephemeral: true
	});
}*/

/**
 * The difference to "/story show" is that it will show stories that are not visible to others
 * (e.g. because they have unlock triggers or are in a testing status)
 * and that it will list more details about a story and show different actions.
 */
async function handleShowStories(interaction, t, logger) {
	const guildId = interaction.guildId;
	const storyId = interaction.options.getString('title');

	if (storyId) {
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

		// TODO styling with colour and picture, shared with /story show
		const storyEmbed = new MessageEmbed().setTitle(story.title);
		if (story.author) {
			storyEmbed.setAuthor({ name: story.author });
		}
		if (story.teaser) {
			storyEmbed.setDescription(story.teaser);
		}
		storyEmbed.addFields([
			{ name: t.user('show-field-editor'), value: userMention(story.editorId), inline: false },
			{ name: t.user('show-field-status'), value: t.user('story-status-' + story.status), inline: false }
		]);
		const buttons = [getEditMetadataButton(t, storyId)];
		if (story.status === StoryStatus.Testing) {
			buttons.push(getPublishButton(t, storyId));
		}
		// TODO later: delete button?
		const components = [
			{
				type: Constants.MessageComponentTypes.ACTION_ROW,
				components: buttons,
				allowed_mentions: {
					parse: []
				}
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
			guildStories = getStories(guildId, false);
		} catch (error) {
			logger.error(error, 'Error while trying to fetch stories from db');
			await t.privateReplyShared(interaction, 'show-stories-failure');
			return;
		}
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
		await sendListReply(interaction, storyTitles, t.user('reply.show-stories'), false, true);
	}
}

async function handlePostStory(interaction, t, logger, guildConfig) {
	const storyId = interaction.options.getString('title', true);
	await postStory(storyId, true, interaction, guildConfig, logger);
}

function getEditMetadataButton(t, storyId) {
	return getTranslatedConfigStoryButton(t, 'edit-metadata-button-label', 'edit-metadata ' + storyId);
}

// TODO this could be confused with posting the story. there's no clear enough explanation what this does. maybe rename it (and the status) to "Release" ("Released")?
function getPublishButton(t, storyId) {
	return getTranslatedConfigStoryButton(
		t,
		'publish-button-label',
		'publish ' + storyId,
		Constants.MessageButtonStyles.SUCCESS
	);
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
		custom_id: getConfigStoryButtonId(innerCustomId)
	};
}

function getConfigStoryButtonId(innerCustomId) {
	return getCustomIdForCommandRouting(configStoryCommand, innerCustomId);
}

async function handleTriggerEditMetadataDialog(interaction, storyId, t, logger) {
	let storyRecord = null;
	try {
		storyRecord = getStory(storyId);
	} catch (e) {
		logger.error(e, 'Error while trying to fetch story from db');
		await errorReply(interaction, t.userShared('story-db-fetch-error'));
		return;
	}
	// TODO guild validation might go into getStory
	if (!storyRecord || storyRecord.guildId !== interaction.guildId) {
		await errorReply(interaction, t.userShared('story-not-found'));
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
	}

	let found;
	try {
		// TODO validate the story is in the right guild. maybe pass guild id to changeStoryMetadata?
		found = changeStoryMetadata(storyId, { title, author, teaser });
	} catch (error) {
		if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
			// TODO if the user opens the dialog again, the fields will all be empty (unless something was stored before).
			//  maybe we want to save the rest of the data at least then and not advance the status.
			await warningReply(interaction, t.user('reply.edit-failure-title-not-unique'));
		} else {
			logger.error(error, 'Error while trying to edit metadata of story.');
			await errorReply(interaction, t.user('reply.edit-failure'));
		}
		return;
	}

	if (found) {
		let storyRecord;
		try {
			storyRecord = getStory(storyId);
		} catch (error) {
			logger.error(error, 'Error while trying to fetch story after editing its metadata.');
			await errorReply(interaction, t.user('reply.edit-failure'));
			return;
		}
		// TODO styling with colour and picture, shared with /story show
		const storyEmbed = new MessageEmbed().setTitle(title);
		if (author) {
			storyEmbed.setAuthor({ name: author });
		}
		if (teaser) {
			storyEmbed.setDescription(teaser);
		}
		let content = t.user('reply.story-metadata-updated');
		const buttons = [getEditMetadataButton(t, storyId)];
		// TODO later: "Playtest" button
		if (storyRecord.status === StoryStatus.Testing) {
			content += '\n' + t.user('reply.story-possible-actions-in-testing');
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
	} else {
		await errorReply(interaction, t.userShared('story-not-found'));
	}
}

async function handlePublishStory(interaction, storyId, t, logger) {
	let found;
	try {
		// TODO validate the story is in the right guild. maybe pass guild id to publishStory?
		found = publishStory(storyId);
	} catch (error) {
		logger.error(error, 'Error while trying to publish story.');
		await errorReply(interaction, t.user('reply.publish-failure'));
	}

	if (found) {
		await disableButtons(interaction);
		await t.privateReply(interaction, 'reply.publish-success');
	} else {
		await errorReply(interaction, t.userShared('story-not-found'));
	}

	// TODO later: provide a way for uploader to test and edit an unpublished story.
	//  stories in testing will show up in /config-story autocomplete / show commands for every user who can use the command and in /story autocomplete / show commands for the editor.

	// TODO later: via config commands you can publish a story for everyone or selectively or you can set unlock triggers
	//  so stories become available to someone if they e.g. completed another story (or got a certain ending in it).
}

export default configStoryCommand;
