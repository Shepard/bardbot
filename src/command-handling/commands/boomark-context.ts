import {
	ApplicationCommandType,
	EmbedBuilder,
	MessageContextMenuCommandInteraction,
	TextBasedChannel
} from 'discord.js';
import { GuildCommandModule } from '../command-module-types.js';
import { FullGuildConfiguration, MessageType } from '../../storage/record-types.js';
import { bookmarkMessages, hasBookmarksChannel } from './bookmark.js';
import { addMessageMetadata } from '../../storage/message-metadata-dao.js';
import { warningReply } from '../../util/interaction-util.js';

const bookmarkContextCommand: GuildCommandModule<MessageContextMenuCommandInteraction> = {
	configuration: {
		name: 'Bookmark',
		type: ApplicationCommandType.Message
	},
	// We want to reuse the translations of the bookmark slash command so we use the key prefix to get the same ones.
	i18nKeyPrefix: 'bookmark',
	// However for the purpose of translating the name of this context command (which should translate differently than the slash command)
	// we want to use a different prefix, so we provide this special override.
	commandNameKeyPrefixOverride: 'bookmark-context',
	guard(guildConfig, logger, client) {
		if (hasBookmarksChannel(guildConfig)) {
			if (!client) {
				return true;
			} else {
				const bookmarksChannel = client.channels.cache.get(guildConfig.bookmarksChannelId);
				if (bookmarksChannel) {
					return true;
				}
			}
		}
		return false;
	},
	async execute(interaction, { t, guildConfig, logger }) {
		// Get message that the context menu command was used on.
		const message = interaction.targetMessage;
		// The bookmark command will only work with text-based messages, not e.g. embeds.
		if (message?.content) {
			const bookmarksChannel = interaction.client.channels.cache.get(
				(guildConfig as FullGuildConfiguration).bookmarksChannelId
			) as TextBasedChannel;

			// Create message in bookmarks channel linking back to the message the command was used on (and also pointing to the channel it came from).
			// To make things a bit more varied and fun, a random message is picked from a set of prepared messages.
			const bookmarkMessageEmbed = new EmbedBuilder().setDescription(
				`${bookmarkMessages.any(message.url, interaction.channelId, t.guild)}\n\n${message.content}`
			);
			const bookmarkMessage = await bookmarksChannel.send({
				embeds: [bookmarkMessageEmbed],
				// Suppress mentions because we don't want to ping people mentioned in the content of the message being bookmarked.
				allowedMentions: {
					parse: []
				}
			});

			// Some positive feedback for the user who used the command (only visible to them).
			// If we don't send any reply, discord will show the command as failed after a while.
			await t.privateReply(interaction, 'reply.success', { url: bookmarkMessage.url, channel: bookmarksChannel.id });

			addMessageMetadata(bookmarkMessage, interaction.user.id, MessageType.Bookmark, logger);
		} else {
			await warningReply(interaction, t.user('reply.no-bookmarkable-content'));
		}
	}
};

export default bookmarkContextCommand;
