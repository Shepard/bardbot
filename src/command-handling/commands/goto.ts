import {
	ApplicationCommandType,
	ApplicationCommandOptionType,
	EmbedBuilder,
	ChannelType,
	ChatInputCommandInteraction,
	TextBasedChannel
} from 'discord.js';
import { CommandModule } from '../command-module-types.js';
import { MessageType } from '../../storage/record-types.js';
import { addMessageMetadata } from '../../storage/message-metadata-dao.js';
import { MESSAGE_CONTENT_CHARACTER_LIMIT } from '../../util/discord-constants.js';

const gotoCommand: CommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'goto',
		description: '',
		type: ApplicationCommandType.ChatInput,
		dmPermission: false,
		options: [
			{
				name: 'destination',
				description: '',
				type: ApplicationCommandOptionType.Channel,
				channel_types: [ChannelType.GuildText, ChannelType.PublicThread],
				required: true
			},
			{
				name: 'action',
				description: '',
				type: ApplicationCommandOptionType.String,
				// This needs to be limited so that the text the user entered + the link sentence we add below fit into the message limit.
				max_length: MESSAGE_CONTENT_CHARACTER_LIMIT - 200
			}
		]
	},
	async execute(interaction, { t, logger }) {
		// We don't have to worry about the bot reopening locked threads with its MANAGE_THREADS permission:
		// For the source channel, the user won't be able to type the command in there.
		// And for the destination channel, Discord won't let them choose it for the option.
		const sourceChannel = interaction.channel;
		const destinationChannel = interaction.options.getChannel('destination') as TextBasedChannel;
		let actionMessageText = interaction.options.getString('action');
		if (actionMessageText) {
			actionMessageText += '\n';
		} else {
			actionMessageText = '';
		}

		// Send a message in the channel where the user used the command, as as reply to their command call,
		// pointing people to the channel where the action continues. If the user entered some action text,
		// preprend that to the message.
		const sourceMessage = await interaction.reply({
			content: actionMessageText + t.guild('reply.origin-message-unlinked', { channel: destinationChannel.id }),
			fetchReply: true,
			// We could try to find out which roles the member is allowed to ping in a complicated way but it's easier to just restrict it to none.
			allowedMentions: {
				parse: []
			}
		});

		// Send a message to the channel where the action moved to, pointing people back at the channel where the action originated
		// and specifically linking back to the message sent above.
		// This message is written as an embed so that it can contain a link without having the URL visible
		// (which interaction replies can do as well but regular messages can't). The embed creates an unnecessary box around
		// the message but maybe that's a good thing because it makes it more visible. An alternative would've been a link button
		// added below the message. But while testing in the Android app it turned out that link buttons never work to take the user
		// to a specific message in a channel, the app will just jump to the end of the channel. Links embedded in messages on the
		// other hand work some of the time.
		const destinationMessageEmbed = new EmbedBuilder().setDescription(
			t.guild('reply.destination-message', { url: sourceMessage.url, channel: sourceChannel.id })
		);
		const destinationMessage = await destinationChannel.send({
			embeds: [destinationMessageEmbed]
		});

		// As a last step we edit the original reply message to the command usage again. We now have a URL to the message in the
		// destination channel and we'll use it to create a link in this original message, pointing at the other message.
		await interaction.editReply(
			actionMessageText +
				t.guild('reply.origin-message-linked', { url: destinationMessage.url, channel: destinationChannel.id })
		);

		addMessageMetadata(destinationMessage, interaction.user.id, MessageType.Arrival, logger);
	}
};

export default gotoCommand;
