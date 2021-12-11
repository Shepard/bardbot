import { Constants } from 'discord.js';

const cointossCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'cointoss',
		description: 'Toss a coin and see what side it lands on',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT
	},
	// Handler for when the command is used
	async execute(interaction) {
		const result = Math.floor(Math.random() * 2) == 0 ? 'heads' : 'tails';
		await interaction.reply({
			content: `${interaction.member.displayName} tosses a coin. It lands on… ${result}!`
		});
	}
};

export default cointossCommand;
