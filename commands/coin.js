import { Constants } from 'discord.js';

const cointossCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'coin',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT
	},
	// Handler for when the command is used
	async execute(interaction, { t }) {
		const result = Math.floor(Math.random() * 2) == 0 ? t.guild('heads') : t.guild('tails');
		await interaction.reply({
			content: t.guild('reply', { member: interaction.member.displayName, result })
		});
	}
};

export default cointossCommand;
