import { hyperlink, channelMention } from '@discordjs/builders';
import { Constants, MessageEmbed } from 'discord.js';

const gotoCommand = {
	// Data for registering the command
	data: {
		name: 'goto',
		description: 'Creates a link in the lore for when characters move between two location channels.',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'destination',
				description: 'The destination channel to go to',
				type: Constants.ApplicationCommandOptionTypes.CHANNEL,
				required: true
			},
			{
				name: 'action',
				description: 'A short description of the action taking place as people move between places',
				type: Constants.ApplicationCommandOptionTypes.STRING
			}
		]
	},
	// Handler for when the command is used
	async execute(interaction) {
		const sourceChannel = interaction.channel;
		const destinationChannel = interaction.options.getChannel('destination');
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
			content: actionMessageText + `The story continues in ${channelMention(destinationChannel.id)}.`,
			fetchReply: true
		});

		// Send a message to the channel where the action moved to, pointing people back at the channel where the action originated
		// and specifically linking back to the message sent above.
		// This message is written as an embed so that it can contain a link without having the URL visible
		// (which interaction replies can do as well but regular messages can't). The embed creates an unnecessary box around
		// the message but maybe that's a good thing because it makes it more visible. An alternative would've been a link button
		// added below the message. But while testing in the Android app it turned out that link buttons never work to take the user
		// to a specific message in a channel, the app will just jump to the end of the channel. Links embedded in messages on the
		// other hand work some of the time.
		const destinationMessageEmbed = new MessageEmbed()
			.setDescription(`${hyperlink('People arrived', sourceMessage.url)} from ${channelMention(sourceChannel.id)}. The story continues here.`);
		const destinationMessage = await destinationChannel.send({
			embeds: [destinationMessageEmbed]
		});

		// As a last step we edit the original reply message to the command usage again. We now have a URL to the message in the
		// destination channel and we'll use it to create a link in this original message, pointing at the other message.
		await interaction.editReply(actionMessageText + `The ${hyperlink('story continues', destinationMessage.url)} in ${channelMention(destinationChannel.id)}.`);
	}
};

export default gotoCommand;