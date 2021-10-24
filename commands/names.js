import { userMention } from '@discordjs/builders';
import { Constants, MessageEmbed } from 'discord.js';

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

		// Retieve all (non-bot) members of this guild and add their names to the list.
		let messageText = '';
		const members = await interaction.guild.members.fetch();
		members.each(member => {
			if (!member.user.bot) {
				if (messageText) {
					messageText += '\n';
				}
				messageText += `${member.displayName} - ${userMention(member.id)}`;
			}
		});

		// Send member list as an embed message, editing the original deferred reply.
		const embed = new MessageEmbed()
			.setTitle(`When we turn the back the pages, the members of ${interaction.guild.name} had the following names:`)
			.setDescription(messageText);
		await interaction.editReply({
			embeds: [embed],
			// Suppress mentions because we don't want to ping people.
			allowed_mentions: {
				parse: []
			}
		});
	}
};

export default namesCommand;