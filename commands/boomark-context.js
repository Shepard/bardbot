import { hyperlink, channelMention } from '@discordjs/builders';
import { Constants, MessageEmbed } from 'discord.js';

const bookmarkContextCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'Bookmark',
		type: Constants.ApplicationCommandTypes.MESSAGE
	},
	// Test function to check if the command should apply to a guild
	guard(client, guild, guildConfig) {
		if (guildConfig && guildConfig.bookmarksChannel) {
			const bookmarksChannel = client.channels.cache.get(guildConfig.bookmarksChannel);
			if (bookmarksChannel) {
				return true;
			}
		}
		return false;
	},
	// Handler for when the command is used
	async execute(interaction, guildConfig) {
		// Get message that the context menu command was used on.
		const message = await interaction.channel.messages.fetch(interaction.targetId);
		// The bookmark command will only work with text-based messages, not e.g. embeds.
		if (message && message.content) {
			const bookmarksChannel = interaction.client.channels.cache.get(guildConfig.bookmarksChannel);

			// Create message in bookmarks channel linking back to the message the command was used on (and also pointing to the channel it came from).
			const bookmarkMessageEmbed = new MessageEmbed()
				.setDescription(`A ${hyperlink('new chapter', message.url)} was written in ${channelMention(interaction.channelId)}.\n\n${message.content}`);
			const bookmarkMessage = await bookmarksChannel.send({
				embeds: [bookmarkMessageEmbed]
			});

			// Some positive feedback for the user who used the command (only visible to them).
			// If we don't send any reply, discord will show the command as failed after a while.
			await interaction.reply({
				content: `${hyperlink('Your bookmark', bookmarkMessage.url)} was successfully created in ${channelMention(bookmarksChannel.id)}!`,
				ephemeral: true
			});
		} else {
			await interaction.reply({ content: 'This message does not have any text content.', ephemeral: true });
		}
	}
};

export default bookmarkContextCommand;