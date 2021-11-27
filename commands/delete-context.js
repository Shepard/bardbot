import { Constants } from 'discord.js';

const userMentionPattern = /<@(\d+)>/;

const deleteContextCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'Delete',
		type: Constants.ApplicationCommandTypes.MESSAGE
	},
	// Test function to check if the command should apply to a guild
	guard(client, guild, guildConfig) {
		// Can only delete quote and bookmark messages so either of these two features needs to be configured.
		// Otherwise there's no point showing the command.
		if (guildConfig?.bookmarksChannel || guildConfig?.quotesChannel) {
			return true;
		}
		return false;
	},
	// Handler for when the command is used
	async execute(interaction, guildConfig) {
		// Get the message that the context menu command was used on.
		const message = interaction.options.getMessage('message');
		if (message) {
			if (message.author.id === interaction.client.user.id) {
				// This is a message that was created by this bot's user.

				if (message.interaction?.commandName === 'bookmark' && message.interaction?.user.id === interaction.user.id) {
					// This was the bot's reply to a /bookmark command interaction
					// and it was used by the current user so we allow it to be deleted.
					await deleteMessage(message, interaction);
					return;
				} else if (message?.embeds.length && message.embeds[0].description) {
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
		}

		await interaction.reply({
			content: 'This is not a message you can delete. ' +
				'This command will only work on quotes or bookmarks you created or quotes where you were quoted.',
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
		await interaction.reply({ content: 'There was an error trying to delete the message.', ephemeral: true });
		return;
	}
	await interaction.reply({ content: 'Message was successfully deleted.', ephemeral: true });
}

export default deleteContextCommand;