import { userMention } from '@discordjs/builders';
import { Constants, MessageEmbed } from 'discord.js';

// Limit for characters in the description of an embed.
// See https://discord.com/developers/docs/resources/channel#embed-limits
const CHARACTER_LIMIT = 4096;

const namesCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'names',
		description: 'Keep a memory of all the fun nicknames that everyone currently has!',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT
	},
	// Handler for when the command is used
	async execute(interaction) {
		// Defer reply for now so we get more time to reply in case fetching the member list takes an unusual amount of time.
		await interaction.deferReply();

		// Retrieve all (non-bot) members of this guild and add their names to the list.
		let messageText = '';
		const messageTexts = [];
		const members = await interaction.guild.members.fetch();
		members.each(member => {
			if (!member.user.bot && member.user.username !== member.displayName) {
				const newLine = `${member.displayName} - ${userMention(member.id)}`;
				// If messageText would exceed the character limit of embed descriptions by appending this line, split it off into a separate messageText.
				if (messageText.length + newLine.length + 1 /*line break*/ > CHARACTER_LIMIT) {
					messageTexts.push(messageText);
					messageText = newLine;
				} else {
					if (messageText) {
						messageText += '\n';
					}
					messageText += newLine;
				}
			}
		});
		messageTexts.push(messageText);

		// Send member list as messages with embeds. The initial message contains a title and the first batch of names and edits the original deferred reply.

		const embeds = messageTexts.map(text => new MessageEmbed().setDescription(text));
		embeds[0].setTitle(
			`When we turn the back the pages, the members of ${interaction.guild.name} had the following names:`
		);

		// We can send up to ten embeds per message: https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object-messages
		const embedChunks = chunk(embeds, 10);

		const messages = embedChunks.map(embedChunk => ({
			embeds: embedChunk,
			// Suppress mentions because we don't want to ping people.
			allowed_mentions: {
				parse: []
			}
		}));

		await interaction.editReply(messages[0]);

		// If there are more messages needed, send them as follow-ups.
		for (let i = 1; i < messages.length; i++) {
			await interaction.followUp(messages[i]);
		}
	}
};

function chunk(items, chunkSize) {
	const chunked = [];
	for (let i = 0; i < items.length; i += chunkSize) {
		chunked.push(items.slice(i, i + chunkSize));
	}
	return chunked;
}

export default namesCommand;
