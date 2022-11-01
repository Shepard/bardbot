import { ApplicationCommandType, EmbedBuilder, quote } from 'discord.js';
import RandomMessageProvider from '../util/random-message-provider.js';
import { addMessageMetadata, MessageType } from '../storage/message-metadata-dao.js';
import { warningReply } from '../util/interaction-util.js';

const quoteMessages = new RandomMessageProvider()
	.add((author, url, t) => t('reply.gossip1', { author, url }))
	.add((author, url, t) => t('reply.gossip2', { author, url }))
	.add((author, url, t) => t('reply.gossip3', { author, url }))
	.add((author, url, t) => t('reply.gossip4', { author, url }))
	.add((author, url, t) => t('reply.gossip5', { author, url }))
	.add((author, url, t) => t('reply.gossip6', { author, url }))
	.add((author, url, t) => t('reply.gossip7', { author, url }))
	.add((author, url, t) => t('reply.gossip8', { author, url }))
	.add((author, url, t) => t('reply.gossip9', { author, url }))
	.add((author, url, t) => t('reply.gossip10', { author, url }));

const quoteContextCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'Quote',
		type: ApplicationCommandType.Message
	},
	i18nKeyPrefix: 'quote-context',
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
	async execute(interaction, { t, guildConfig, logger }) {
		// Get message that the context menu command was used on.
		const message = interaction.targetMessage;
		// The quote command will only work with text-based messages, not e.g. embeds.
		if (message?.content) {
			const quotesChannel = interaction.client.channels.cache.get(guildConfig.quotesChannel);
			// Can't use block quote for creating the quote because that extends until the end of the message
			// and would thus show the creator line as quoted as well. Inline-quoting will only quote a single
			// line however so we need to apply it to every line of the message.
			const quoteText = message.content
				.split('\n')
				.map(line => quote(line))
				.join('\n');

			// Create message in quotes channel linking back to the message the command was used on (and also pointing to the channel it came from).
			// To make things a bit more varied and fun, a random message is picked from a set of prepared messages.
			const quoteMessageEmbed = new EmbedBuilder().setDescription(
				`${quoteMessages.any(message.author.id, message.url, t.guild)}\n\n${quoteText}`
			);
			const quoteMessage = await quotesChannel.send({
				embeds: [quoteMessageEmbed],
				// Suppress mentions because we don't want to ping people mentioned in the content of the message being quoted.
				allowed_mentions: {
					parse: []
				}
			});

			// Some positive feedback for the user who used the command (only visible to them).
			// If we don't send any reply, discord will show the command as failed after a while.
			await t.privateReply(interaction, 'reply.success', { url: quoteMessage.url, channel: quotesChannel.id });

			addMessageMetadata(quoteMessage, interaction.user.id, MessageType.Quote, logger);
		} else {
			await warningReply(interaction, t.user('reply.not-quotable'));
		}
	}
};

export default quoteContextCommand;
