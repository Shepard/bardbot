import {
	ApplicationCommandType,
	ApplicationCommandOptionType,
	EmbedBuilder,
	ChatInputCommandInteraction,
	TextBasedChannel
} from 'discord.js';
import { GuildCommandModule } from '../command-module-types.js';
import { GuildConfiguration, FullGuildConfiguration, MessageType } from '../../storage/record-types.js';
import RandomMessageProvider from '../../util/random-message-provider.js';
import { addMessageMetadata } from '../../storage/message-metadata-dao.js';
import { MESSAGE_CONTENT_CHARACTER_LIMIT } from '../../util/discord-constants.js';

export const bookmarkMessages = new RandomMessageProvider()
	.add((url, channel, t) => t('reply.header1', { url, channel }))
	.add((url, channel, t) => t('reply.header2', { url, channel }))
	.add((url, channel, t) => t('reply.header3', { url, channel }))
	.add((url, channel, t) => t('reply.header4', { url, channel }))
	.add((url, channel, t) => t('reply.header5', { url, channel }))
	.add((url, channel, t) => t('reply.header6', { url, channel }))
	.add((url, channel, t) => t('reply.header7', { url, channel }));

const bookmarkCommand: GuildCommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'bookmark',
		description: '',
		type: ApplicationCommandType.ChatInput,
		options: [
			{
				name: 'event',
				description: '',
				type: ApplicationCommandOptionType.String,
				required: true,
				max_length: MESSAGE_CONTENT_CHARACTER_LIMIT
			}
		]
	},
	guard(client, guild, guildConfig) {
		if (hasBookmarksChannel(guildConfig)) {
			const bookmarksChannel = client.channels.cache.get(guildConfig.bookmarksChannelId);
			if (bookmarksChannel) {
				return true;
			}
		}
		return false;
	},
	async execute(interaction, { t, guildConfig, logger }) {
		// First send a message in the channel where the user used the command,
		// as a reply to their command call, showing the text they entered with the command.
		const eventMessageText = interaction.options.getString('event');
		const eventMessage = await interaction.reply({
			content: eventMessageText,
			fetchReply: true,
			// We could try to find out which roles the member is allowed to ping in a complicated way but it's easier to just restrict it to none.
			allowedMentions: {
				parse: []
			}
		});

		// Then send a message to the bookmarks channel, pointing back to the message sent above.
		// To make things a bit more varied and fun, a random message is picked from a set of prepared messages.
		const bookmarkMessageEmbed = new EmbedBuilder().setDescription(
			`${bookmarkMessages.any(eventMessage.url, interaction.channelId, t.guild)}\n\n${eventMessageText}`
		);
		const bookmarksChannel = interaction.client.channels.cache.get(
			(guildConfig as FullGuildConfiguration).bookmarksChannelId
		) as TextBasedChannel;
		const bookmarkMessage = await bookmarksChannel.send({
			embeds: [bookmarkMessageEmbed],
			// We don't want any mentions pinging people here.
			allowedMentions: {
				parse: []
			}
		});

		addMessageMetadata(bookmarkMessage, interaction.user.id, MessageType.Bookmark, logger);
	}
};

export function hasBookmarksChannel(guildConfig: GuildConfiguration): guildConfig is FullGuildConfiguration {
	return (guildConfig as FullGuildConfiguration)?.bookmarksChannelId !== undefined;
}

export default bookmarkCommand;
