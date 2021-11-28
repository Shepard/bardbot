import { Constants } from 'discord.js';
import { inlineCode } from '@discordjs/builders';

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
		if (message?.author.id === interaction.client.user.id) {
			// This is a message that was created by this bot's user.

			const commandName = message.interaction?.commandName;
			if (
				(commandName === 'bookmark' || commandName === 'names') &&
				message.interaction?.user.id === interaction.user.id
			) {
				// This was the bot's reply to a /bookmark or /names command interaction
				// and it was used by the current user so we allow it to be deleted.
				await deleteMessage(message, interaction);
				return;
			} else if (message.embeds?.length && message.embeds[0].description && commandName !== 'names') {
				// We're excluding interaction replies to /names here so that the last line of the embed description
				// of that is not checked for mentions (because it can contain an arbitrary user).

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

		await interaction.reply({
			content:
				'This is not a message you can delete. ' +
				'This command will only work on:\n' +
				`- Quotes or bookmarks you created through me (including my reply to the ${inlineCode(
					'/bookmark'
				)} command),\n` +
				'- Quotes someone else created through me where you were quoted,\n' +
				`- My reply to ${inlineCode('/names')}.`,
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

async function deleteMessage(message, interaction) {
	try {
		await message.delete();
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
