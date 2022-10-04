import { Constants, MessageEmbed } from 'discord.js';
import RandomMessageProvider from '../util/random-message-provider.js';
import { addMessageMetadata, MessageType } from '../storage/message-metadata-dao.js';
import { MESSAGE_CONTENT_CHARACTER_LIMIT } from '../util/discord-constants.js';

export const bookmarkMessages = new RandomMessageProvider()
	.add((url, channel, t) => t('reply.header1', { url, channel }))
	.add((url, channel, t) => t('reply.header2', { url, channel }))
	.add((url, channel, t) => t('reply.header3', { url, channel }))
	.add((url, channel, t) => t('reply.header4', { url, channel }))
	.add((url, channel, t) => t('reply.header5', { url, channel }))
	.add((url, channel, t) => t('reply.header6', { url, channel }))
	.add((url, channel, t) => t('reply.header7', { url, channel }));

const bookmarkCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'bookmark',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'event',
				type: Constants.ApplicationCommandOptionTypes.STRING,
				required: true,
				max_length: MESSAGE_CONTENT_CHARACTER_LIMIT
			}
		]
	},
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
		// First send a message in the channel where the user used the command,
		// as a reply to their command call, showing the text they entered with the command.
		const eventMessageText = interaction.options.getString('event');
		const eventMessage = await interaction.reply({
			content: eventMessageText,
			fetchReply: true,
			// We could try to find out which roles the member is allowed to ping in a complicated way but it's easier to just restrict it to none.
			allowed_mentions: {
				parse: []
			}
		});

		// Then send a message to the bookmarks channel, pointing back to the message sent above.
		// To make things a bit more varied and fun, a random message is picked from a set of prepared messages.
		const bookmarkMessageEmbed = new MessageEmbed().setDescription(
			`${bookmarkMessages.any(eventMessage.url, interaction.channelId, t.guild)}\n\n${eventMessageText}`
		);
		const bookmarksChannel = interaction.client.channels.cache.get(guildConfig.bookmarksChannel);
		const bookmarkMessage = await bookmarksChannel.send({
			embeds: [bookmarkMessageEmbed],
			// We don't want any mentions pinging people here.
			allowed_mentions: {
				parse: []
			}
		});

		addMessageMetadata(bookmarkMessage, interaction.user.id, MessageType.Bookmark, logger);
	}
};

export default bookmarkCommand;
