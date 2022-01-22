import { Constants, MessageEmbed } from 'discord.js';
import { bookmarkMessages } from './bookmark.js';
import { addMessageMetadata, MessageType } from '../storage/message-metadata-dao.js';

const bookmarkContextCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'Bookmark',
		type: Constants.ApplicationCommandTypes.MESSAGE
	},
	i18nKeyPrefix: 'bookmark',
	// Test function to check if the command should apply to a guild
	guard(client, guild, guildConfig) {
		if (guildConfig?.bookmarksChannel) {
			const bookmarksChannel = client.channels.cache.get(guildConfig.bookmarksChannel);
			if (bookmarksChannel) {
				return true;
			}
		}
		return false;
	},
	// Handler for when the command is used
	async execute(interaction, { t, guildConfig, logger }) {
		// Get message that the context menu command was used on.
		const message = interaction.targetMessage;
		// The bookmark command will only work with text-based messages, not e.g. embeds.
		if (message?.content) {
			const bookmarksChannel = interaction.client.channels.cache.get(guildConfig.bookmarksChannel);

			// Create message in bookmarks channel linking back to the message the command was used on (and also pointing to the channel it came from).
			// To make things a bit more varied and fun, a random message is picked from a set of prepared messages.
			const bookmarkMessageEmbed = new MessageEmbed().setDescription(
				`${bookmarkMessages.any(message.url, interaction.channelId, t.guild)}\n\n${message.content}`
			);
			const bookmarkMessage = await bookmarksChannel.send({
				embeds: [bookmarkMessageEmbed],
				// Suppress mentions because we don't want to ping people mentioned in the content of the message being bookmarked.
				allowed_mentions: {
					parse: []
				}
			});

			// Some positive feedback for the user who used the command (only visible to them).
			// If we don't send any reply, discord will show the command as failed after a while.
			await t.privateReply(interaction, 'reply.success', { url: bookmarkMessage.url, channel: bookmarksChannel.id });

			addMessageMetadata(bookmarkMessage, interaction.user.id, MessageType.Bookmark, logger);
		} else {
			await t.privateReply(interaction, 'reply.no-bookmarkable-content');
		}
	}
};

export default bookmarkContextCommand;
