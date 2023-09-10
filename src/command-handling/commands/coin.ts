import { ApplicationCommandType, ChatInputCommandInteraction } from 'discord.js';
import { getMemberDisplayName } from '../../util/interaction-util.js';
import { CommandModule } from '../command-module-types.js';

const cointossCommand: CommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'coin',
		description: '',
		type: ApplicationCommandType.ChatInput
	},
	async execute(interaction, { t }) {
		const result = Math.floor(Math.random() * 2) == 0 ? t.guild('heads') : t.guild('tails');
		await interaction.reply({
			content: t.guild('reply', { member: getMemberDisplayName(interaction), result })
		});
	}
};

export default cointossCommand;
