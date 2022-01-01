import { Constants } from 'discord.js';
import { inlineCode } from '@discordjs/builders';
import { getMessageMetadata } from '../storage/message-metadata-dao.js';
import { getWebhookForMessageIfCreatedByBot } from '../util/webhook-util.js';

const userMentionPattern = /<@(\d+)>/;

const deleteContextCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'Delete',
		type: Constants.ApplicationCommandTypes.MESSAGE
	},
	// Handler for when the command is used
	async execute(interaction) {
		// Get the message that the context menu command was used on.
		const message = interaction.options.getMessage('message');
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
					await deleteMessage(message, interaction);
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
						await deleteMessage(message, interaction);
						return;
					}
				}
			}

			// Check if we have any metadata saved saying that this message was sent in this user's name.
			// The message might not necessarily have been created by this bot but it might have been sent by a webhook under the bot's control.
			const messageMetadata = getMessageMetadata(message.id);
			if (messageMetadata?.interactingUserId === interaction.user.id) {
				if (isMessageAuthoredByBot(message)) {
					await deleteMessage(message, interaction);
					return;
				}
				const webhook = await getWebhookForMessageIfCreatedByBot(message);
				if (webhook) {
					await deleteMessage(message, interaction, webhook);
					return;
				}
			}
		}

		await interaction.reply({
			content:
				'This is not a message you can delete. ' +
				'This command will only work on:\n' +
				`- Quotes or bookmarks you created through me (including my reply to the ${inlineCode(
					'/bookmark'
				)} command),\n` +
				'- Quotes someone else created through me where you were quoted,\n' +
				`- My reply to ${inlineCode('/goto')} and the corresponding message in the destination channel,\n` +
				`- My reply to ${inlineCode('/narrate')},\n` +
				`- My reply to ${inlineCode('/names')},\n` +
				`- Messages of alternate characters sent through me.`,
			ephemeral: true
		});
	}
};

function isUserMentioned(line, currentUserId) {
	const userMatch = line.match(userMentionPattern);
	if (userMatch) {
		const mentionedUserId = userMatch[1];
		return mentionedUserId === currentUserId;
	}
	return false;
}

function isMessageAuthoredByBot(message) {
	return message.author.id === message.client.user.id;
}

async function deleteMessage(message, interaction, webhook) {
	try {
		if (webhook) {
			await webhook.deleteMessage(message);
		} else {
			await message.delete();
		}

		// We don't need to delete the metadata we stored for this message here.
		// We will receive a messageDelete event in which we do that.
	} catch (e) {
		console.error('Error while trying to delete message:', e);
		await interaction.reply({
			content: 'There was an error trying to delete the message.',
			ephemeral: true
		});
		return;
	}
	await interaction.reply({
		content: 'Message was successfully deleted.',
		ephemeral: true
	});
}

export default deleteContextCommand;
