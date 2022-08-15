import { Constants, Modal, MessageActionRow, TextInputComponent } from 'discord.js';
import { getMessageMetadata, MessageType } from '../storage/message-metadata-dao.js';
import { getWebhookForMessageIfCreatedByBot } from '../util/webhook-util.js';
import { getCustomIdForCommandRouting } from '../util/interaction-util.js';
import { MESSAGE_CONTENT_CHARACTER_LIMIT } from '../util/discord-constants.js';

const editContextCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'Edit',
		type: Constants.ApplicationCommandTypes.MESSAGE
	},
	i18nKeyPrefix: 'edit-context',
	// Handler for when the command is used
	async execute(interaction, { t, logger }) {
		// Get the message that the context menu command was used on.
		const message = interaction.targetMessage;
		if (message) {
			if (isNarrateReplyToCurrentUser(message, interaction)) {
				// This was the bot's reply to a /narrate command interaction
				// and it was used by the current user so we allow it to be edited.
				await showEditMessageDialog(message, interaction, t);
				return;
			}

			if (isAltMessageReplyToCurrentUser(message, interaction, logger)) {
				const webhook = await getWebhookForMessageIfCreatedByBot(message, logger);
				if (webhook) {
					// This is an alt reply that was sent by a webhook under the bot's control.
					await showEditMessageDialog(message, interaction, t);
					return;
				}
			}
		}

		await interaction.reply({
			content:
				t.user('reply.not-editable1') + '\n' + t.user('reply.not-editable2') + '\n' + t.user('reply.not-editable3'),
			ephemeral: true
		});
	},
	async modalInteraction(interaction, innerCustomId, { t, logger }) {
		if (innerCustomId.startsWith('edit-dialog message ')) {
			const messageId = innerCustomId.substring('edit-dialog message '.length);
			const messageText = interaction.fields.getTextInputValue('edit-dialog-message-text');
			await editMessage(interaction, messageId, messageText, t, logger);
		} else {
			// This is not an interaction we can handle.
			// We need to reply to the interaction, otherwise it will be shown as pending and eventually failed.
			await t.privateReplyShared(interaction, 'unknown-command');
		}
	}
};

function isNarrateReplyToCurrentUser(message, interaction) {
	const commandName = message.interaction?.commandName;
	return (
		isMessageAuthoredByBot(message) && commandName === 'narrate' && message.interaction?.user.id === interaction.user.id
	);
}

function isMessageAuthoredByBot(message) {
	return message.author.id === message.client.user.id;
}

function isAltMessageReplyToCurrentUser(message, interaction, logger) {
	// Check if we have any metadata saved saying that this message was sent in this user's name.
	const messageMetadata = getMessageMetadata(message.id, logger);
	return (
		messageMetadata?.interactingUserId === interaction.user.id && messageMetadata.messageType === MessageType.AltMessage
	);
}

async function showEditMessageDialog(message, interaction, t) {
	const dialogId = getCustomIdForCommandRouting(editContextCommand, 'edit-dialog message ' + message.id);
	const editDialog = new Modal().setCustomId(dialogId).setTitle(t.user('reply.edit-dialog-title'));

	const messageEditField = new TextInputComponent()
		.setCustomId('edit-dialog-message-text')
		.setLabel(t.user('reply.edit-dialog-text-field-label'))
		.setValue(message.content)
		.setStyle(Constants.TextInputStyles[Constants.TextInputStyles.PARAGRAPH])
		.setRequired(true)
		.setMinLength(1)
		.setMaxLength(MESSAGE_CONTENT_CHARACTER_LIMIT);

	editDialog.addComponents(new MessageActionRow().addComponents(messageEditField));

	await interaction.showModal(editDialog);
}

async function editMessage(interaction, messageId, messageText, t, logger) {
	try {
		const message = await interaction.channel.messages.fetch(messageId);
		if (message) {
			if (isNarrateReplyToCurrentUser(message, interaction)) {
				await message.edit(messageText);
				await t.privateReply(interaction, 'reply.edit-success');
				return;
			}

			if (isAltMessageReplyToCurrentUser(message, interaction, logger)) {
				const webhook = await getWebhookForMessageIfCreatedByBot(message, logger);
				if (webhook) {
					await webhook.editMessage(message, messageText);
					await t.privateReply(interaction, 'reply.edit-success');
					return;
				}
			}
		}
	} catch (error) {
		logger.error(error, 'Error while trying to edit message');
	}
	await t.privateReply(interaction, 'reply.edit-failure');
}

export default editContextCommand;
