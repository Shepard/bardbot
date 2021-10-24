import { hyperlink, channelMention } from '@discordjs/builders';
import { Constants, MessageEmbed } from 'discord.js';

const bookmarkCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'bookmark',
		description: 'Creates a bookmark to identify a new chapter in the lore for easy referencing.',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'event',
				description: 'Description of the event starting the chapter',
				type: Constants.ApplicationCommandOptionTypes.STRING,
				required: true
			}
		]
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
		// First send a message in the channel where the user used the command,
		// as a reply to their command call, showing the text they entered with the command.
		const eventMessageText = interaction.options.getString('event');
		const eventMessage = await interaction.reply({
			content: eventMessageText,
			fetchReply: true
		});

		// Then send a message to the bookmarks channel, pointing back to the message sent above.
		const bookmarkMessageEmbed = new MessageEmbed()
			.setDescription(`A ${hyperlink('new chapter', eventMessage.url)} was written in ${channelMention(interaction.channelId)}.\n\n${eventMessageText}`);
		const bookmarksChannel = interaction.client.channels.cache.get(guildConfig.bookmarksChannel);
		await bookmarksChannel.send({
			embeds: [bookmarkMessageEmbed]
		});
	}
};

export default bookmarkCommand;