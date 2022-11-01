import { ApplicationCommandType } from 'discord.js';

const cointossCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'coin',
		type: ApplicationCommandType.ChatInput
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
