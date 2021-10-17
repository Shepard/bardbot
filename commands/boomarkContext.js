import fs from 'fs';
import { hyperlink, channelMention } from '@discordjs/builders';
import { Constants, MessageEmbed } from 'discord.js';

const { guilds } = JSON.parse(fs.readFileSync('./config.json'));

const bookmarkContextCommand = {
	// Data for registering the command
	data: {
		name: 'Bookmark',
		type: Constants.ApplicationCommandTypes.MESSAGE
	},
	// Handler for when the command is used
	async execute(interaction) {
		// TODO Check this as a condition for registering the command. And extract the check/fetching.
		const guildConfig = guilds.find(guild => guild.id === interaction.guildId);
		if (guildConfig && guildConfig.bookmarksChannel) {
			const bookmarksChannel = interaction.client.channels.cache.get(guildConfig.bookmarksChannel);
			if (bookmarksChannel) {
				// Get message that the context menu command was used on.
				const message = await interaction.channel.messages.fetch(interaction.targetId);
				// The bookmark command will only work with text-based messages, not e.g. embeds.
				if (message && message.content) {
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
			} else {
				console.log(`Bookmark was requested but configured bookmarks channel ${guildConfig.bookmarksChannel} could not be found for guild ${interaction.guildId}.`);
			}
		} else {
			console.log(`Bookmark was requested but no bookmarks channel has been configured for guild ${interaction.guildId}.`);
		}
	}
};

export default bookmarkContextCommand;