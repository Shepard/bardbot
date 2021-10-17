import fs from 'fs';
import { hyperlink, channelMention } from '@discordjs/builders';
import { Constants, MessageEmbed } from 'discord.js';

const { guilds } = JSON.parse(fs.readFileSync('./config.json'));

const bookmarkCommand = {
	// Data for registering the command
	data: {
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
	// Handler for when the command is used
	async execute(interaction) {
		const guildConfig = guilds.find(guild => guild.id === interaction.guildId);
		if (guildConfig && guildConfig.bookmarksChannel) {
			const bookmarksChannel = interaction.client.channels.cache.get(guildConfig.bookmarksChannel);
			if (bookmarksChannel) {
				// First send a message in the channel where the user used the command,
				// as as reply to their command call, showing the text they entered with the command.
				const eventMessageText = interaction.options.getString('event');
				const eventMessage = await interaction.reply({
					content: eventMessageText,
					fetchReply: true
				});

				// Then send a message to the bookmarks channel, pointing back to the message sent above.
				const bookmarkMessageEmbed = new MessageEmbed()
					.setDescription(`A ${hyperlink('new chapter', eventMessage.url)} was written in ${channelMention(interaction.channelId)}.\n\n${eventMessageText}`);
				await bookmarksChannel.send({
					embeds: [bookmarkMessageEmbed]
				});
			} else {
				console.log(`Bookmark was requested but configured bookmarks channel ${guildConfig.bookmarksChannel} could not be found for guild ${interaction.guildId}.`);
			}
		} else {
			console.log(`Bookmark was requested but no bookmarks channel has been configured for guild ${interaction.guildId}.`);
		}
	}
};

export default bookmarkCommand;