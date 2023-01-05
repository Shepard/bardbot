import {
	ApplicationCommandType,
	ModalBuilder,
	ActionRowBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageContextMenuCommandInteraction,
	Message,
	ModalSubmitInteraction,
	BaseInteraction
} from 'discord.js';
import { Logger } from 'pino';
import { CommandModule } from '../command-module-types.js';
import { ContextTranslatorFunctions } from '../../util/interaction-types.js';
import { MessageType } from '../../storage/record-types.js';
import { getMessageMetadata } from '../../storage/message-metadata-dao.js';
import { getWebhookForMessageIfCreatedByBot } from '../../util/webhook-util.js';
import { errorReply, getCustomIdForCommandRouting, warningReply } from '../../util/interaction-util.js';
import { MESSAGE_CONTENT_CHARACTER_LIMIT } from '../../util/discord-constants.js';

const editContextCommand: CommandModule<MessageContextMenuCommandInteraction> = {
	configuration: {
		name: 'Edit',
		type: ApplicationCommandType.Message,
		dmPermission: false
	},
	i18nKeyPrefix: 'edit-context',
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

		await warningReply(
			interaction,
			t.user('reply.not-editable1') +
				'\n' +
				t.user('reply.not-editable2', { command: '/narrate', guildId: interaction.guildId }) +
				'\n' +
				t.user('reply.not-editable3')
		);
	},
	async modalInteraction(interaction, innerCustomId, { t, logger }) {
		if (innerCustomId.startsWith('edit-dialog message ')) {
			const messageId = innerCustomId.substring('edit-dialog message '.length);
			const messageText = interaction.fields.getTextInputValue('edit-dialog-message-text');
			await editMessage(interaction, messageId, messageText, t, logger);
		} else {
			// This is not an interaction we can handle.
			// We need to reply to the interaction, otherwise it will be shown as pending and eventually failed.
			await warningReply(interaction, t.userShared('unknown-command'));
		}
	}
};

function isNarrateReplyToCurrentUser(message: Message, interaction: BaseInteraction) {
	const commandName = message.interaction?.commandName;
	return (
		isMessageAuthoredByBot(message) && commandName === 'narrate' && message.interaction?.user.id === interaction.user.id
	);
}

function isMessageAuthoredByBot(message: Message) {
	return message.author.id === message.client.user.id;
}

function isAltMessageReplyToCurrentUser(message: Message, interaction: BaseInteraction, logger: Logger) {
	// Check if we have any metadata saved saying that this message was sent in this user's name.
	const messageMetadata = getMessageMetadata(message.id, logger);
	return (
		messageMetadata?.interactingUserId === interaction.user.id && messageMetadata.messageType === MessageType.AltMessage
	);
}

async function showEditMessageDialog(
	message: Message,
	interaction: MessageContextMenuCommandInteraction,
	t: ContextTranslatorFunctions
) {
	const dialogId = getCustomIdForCommandRouting(editContextCommand, 'edit-dialog message ' + message.id);
	const editDialog = new ModalBuilder().setCustomId(dialogId).setTitle(t.user('reply.edit-dialog-title'));

	const messageEditField = new TextInputBuilder()
		.setCustomId('edit-dialog-message-text')
		.setLabel(t.user('reply.edit-dialog-text-field-label'))
		.setValue(message.content)
		.setStyle(TextInputStyle.Paragraph)
		.setRequired(true)
		.setMinLength(1)
		.setMaxLength(MESSAGE_CONTENT_CHARACTER_LIMIT);

	editDialog.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(messageEditField));

	await interaction.showModal(editDialog);
}

async function editMessage(
	interaction: ModalSubmitInteraction,
	messageId: string,
	messageText: string,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
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
	await errorReply(interaction, t.user('reply.edit-failure'));
}

export default editContextCommand;
