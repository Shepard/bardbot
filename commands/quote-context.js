import { hyperlink, userMention, channelMention, quote, italic } from '@discordjs/builders';
import { Constants, MessageEmbed } from 'discord.js';
import RandomMessageProvider from '../random-message-provider.js';

const quoteMessages = new RandomMessageProvider()
	.add((author, url) => `Did you hear what ${userMention(author)} ${hyperlink('just said', url)}?`)
	.add((author, url) => `I can't believe ${userMention(author)} ${hyperlink('said that', url)}.`)
	.add((author, url) => `${hyperlink('What was that', url)}, ${userMention(author)}?`)
	.add((author, url) => `Did ${userMention(author)} ${italic('really')} ${hyperlink('say that', url)}?`)
	.add((author, url) => `${userMention(author)}, did you actually just ${hyperlink('say that', url)}?`)
	.add((author, url) => `Look at ${userMention(author)} just ${hyperlink('saying things', url)} without a care in the world!`)
	.add((author, url) => `Now ${hyperlink('that\'s something quotable', url)}, ${userMention(author)}!`)
	.add((author, url) => `Don't mind me, just making a note of what ${userMention(author)} ${hyperlink('just said', url)}.`)
	.add((author, url) => `Hey, those were ${userMention(author)}'s ${hyperlink('words', url)}, not mine!`)
	.add((author, url) => `So, we're ${hyperlink('saying that', url)} now, are we, ${userMention(author)}?`);

const quoteContextCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'Quote',
		type: Constants.ApplicationCommandTypes.MESSAGE
	},
	// Test function to check if the command should apply to a guild
	guard(client, guild, guildConfig) {
		if (guildConfig?.quotesChannel) {
			const quotesChannel = client.channels.cache.get(guildConfig.quotesChannel);
			if (quotesChannel) {
				return true;
			}
		}
		return false;
	},
	// Handler for when the command is used
	async execute(interaction, guildConfig) {
		// Get message that the context menu command was used on.
		const message = interaction.options.getMessage('message');
		// The quote command will only work with text-based messages, not e.g. embeds.
		if (message?.content) {
			const quotesChannel = interaction.client.channels.cache.get(guildConfig.quotesChannel);
			// Can't use block quote for creating the quote because that extends until the end of the message
			// and would thus show the creator line as quoted as well. Inline-quoting will only quote a single
			// line however so we need to apply it to every line of the message.
			const quoteText = message.content.split('\n').map(line => quote(line)).join('\n');

			// Create message in quotes channel linking back to the message the command was used on (and also pointing to the channel it came from).
			// To make things a bit more varied and fun, a random message is picked from a set of prepared messages.
			const quoteMessageEmbed = new MessageEmbed()
				.setDescription(`${quoteMessages.any(message.author.id, message.url)}\n${quoteText}\n\nQuote created by ${userMention(interaction.user.id)}`);
			const quoteMessage = await quotesChannel.send({
				embeds: [quoteMessageEmbed],
				// Suppress mentions because we don't want to ping people mentioned in the content of the message being quoted.
				allowed_mentions: {
					parse: []
				}
			});

			// Some positive feedback for the user who used the command (only visible to them).
			// If we don't send any reply, discord will show the command as failed after a while.
			await interaction.reply({
				content: `${hyperlink('A quote', quoteMessage.url)} was successfully created in ${channelMention(quotesChannel.id)}!`,
				ephemeral: true
			});
		} else {
			await interaction.reply({ content: 'This message does not have any quotable content.', ephemeral: true });
		}
	}
};

export default quoteContextCommand;