import { ApplicationCommandType, MessageContextMenuCommandInteraction, Message, Webhook } from 'discord.js';
import { Logger } from 'pino';
import { CommandModule } from '../command-module-types.js';
import { ContextTranslatorFunctions } from '../../util/interaction-types.js';
import { getMessageMetadata } from '../../storage/message-metadata-dao.js';
import { errorReply, warningReply } from '../../util/interaction-util.js';
import { getWebhookForMessageIfCreatedByBot } from '../../util/webhook-util.js';

const userMentionPattern = /<@(\d+)>/;

const deleteContextCommand: CommandModule<MessageContextMenuCommandInteraction> = {
	configuration: {
		name: 'Delete',
		type: ApplicationCommandType.Message,
		dmPermission: false
	},
	i18nKeyPrefix: 'delete-context',
	async execute(interaction, { t, logger }) {
		// Get the message that the context menu command was used on.
		const message = interaction.targetMessage;
		if (message) {
			if (isMessageAuthoredByBot(message)) {
				// This is a message that was created by this bot's user.

				const commandName = message.interaction?.commandName;
				if (
					(commandName === 'bookmark' ||
						commandName === 'names' ||
						commandName === 'goto' ||
						commandName === 'narrate') &&
					message.interaction?.user.id === interaction.user.id
				) {
					// This was the bot's reply to a command interaction
					// and it was used by the current user so we allow it to be deleted.
					await deleteMessage(message, interaction, t, logger);
					return;
				} else if (message.embeds?.length && message.embeds[0].description && commandName !== 'names') {
					// We're excluding interaction replies to /names here so that the last line of the embed description
					// of that is not checked for mentions (because it can contain an arbitrary user).

					// TODO Remove most of this after the metadata-based approach has been deployed for a while.
					//  Not sure yet if the metadata should also contain the quoted user.

					const lines = message.embeds[0].description.split('\n');
					const firstLine = lines[0];
					const lastLine = lines[lines.length - 1];

					// Check if there's a user mention in the first or last line of the embed's description.
					// So they're likely either the person being quoted (first line)
					// and thus have a right for this quote to be removed for the sake of fairness.
					// Or they're the creator of the quote or bookmark (last line)
					// and thus definitely should be able to remove it.
					if (isUserMentioned(firstLine, interaction.user.id) || isUserMentioned(lastLine, interaction.user.id)) {
						await deleteMessage(message, interaction, t, logger);
						return;
					}
				}
			}

			// Check if we have any metadata saved saying that this message was sent in this user's name.
			// The message might not necessarily have been created by this bot but it might have been sent by a webhook under the bot's control.
			const messageMetadata = getMessageMetadata(message.id, logger);
			if (messageMetadata?.interactingUserId === interaction.user.id) {
				if (isMessageAuthoredByBot(message)) {
					await deleteMessage(message, interaction, t, logger);
					return;
				}
				const webhook = await getWebhookForMessageIfCreatedByBot(message, logger);
				if (webhook) {
					await deleteMessage(message, interaction, t, logger, webhook);
					return;
				}
			}
		}

		await warningReply(
			interaction,
			t.user('reply.not-deletable1') +
				'\n' +
				t.user('reply.not-deletable2', { command: '/bookmark', guildId: interaction.guildId }) +
				'\n' +
				t.user('reply.not-deletable3') +
				'\n' +
				t.user('reply.not-deletable4', { command: '/goto', guildId: interaction.guildId }) +
				'\n' +
				t.user('reply.not-deletable5', { command: '/narrate', guildId: interaction.guildId }) +
				'\n' +
				t.user('reply.not-deletable5', { command: '/names', guildId: interaction.guildId }) +
				'\n' +
				t.user('reply.not-deletable6')
		);
	}
};

function isUserMentioned(line: string, currentUserId: string) {
	const userMatch = line.match(userMentionPattern);
	if (userMatch) {
		const mentionedUserId = userMatch[1];
		return mentionedUserId === currentUserId;
	}
	return false;
}

function isMessageAuthoredByBot(message: Message) {
	return message.author.id === message.client.user.id;
}

async function deleteMessage(
	message: Message,
	interaction: MessageContextMenuCommandInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger,
	webhook?: Webhook
) {
	try {
		if (webhook) {
			await webhook.deleteMessage(message);
		} else {
			await message.delete();
		}

		// We don't need to delete the metadata we stored for this message here.
		// We will receive a messageDelete event in which we do that.
	} catch (e) {
		logger.error(e, 'Error while trying to delete message');
		await errorReply(interaction, t.user('reply.delete-failure'));
		return;
	}
	await t.privateReply(interaction, 'reply.delete-success');
}

export default deleteContextCommand;
