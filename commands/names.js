import { userMention } from '@discordjs/builders';
import { Constants, MessageEmbed } from 'discord.js';

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
		const messages = [];
		const members = await interaction.guild.members.fetch();
		members.each(member => {
			if (!member.user.bot && member.user.username !== member.displayName) {
				const newLine = `${member.displayName} - ${userMention(member.id)}`;
				// If messageText would exceed the character limit of embed descriptions by appending this line, split it off into a separate message.
				if (messageText.length + newLine.length + 1 /*line break*/ > CHARACTER_LIMIT) {
					messages.push(messageText);
					messageText = newLine;
				} else {
					if (messageText) {
						messageText += '\n';
					}
					messageText += newLine;
				}
			}
		});
		messages.push(messageText);

		// Send member list as an embed message, editing the original deferred reply.
		// The initial message contains a title and the first batch of names.
		const embed = new MessageEmbed()
			.setTitle(`When we turn the back the pages, the members of ${interaction.guild.name} had the following names:`)
			.setDescription(messages[0]);
		await interaction.editReply({
			embeds: [embed],
			// Suppress mentions because we don't want to ping people.
			allowed_mentions: {
				parse: []
			}
		});

		// If there are more messages needed, send them as follow-ups.
		for (let i = 1; i < messages.length; i++) {
			const followUpEmbed = new MessageEmbed().setDescription(messages[i]);
			await interaction.followUp({
				embeds: [followUpEmbed],
				allowed_mentions: {
					parse: []
				}
			});
		}
	}
};

export default namesCommand;