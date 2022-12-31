import { ApplicationCommandType, ApplicationCommandOptionType, ChatInputCommandInteraction } from 'discord.js';
import { CommandModule } from '../command-module-types.js';
import { MESSAGE_CONTENT_CHARACTER_LIMIT } from '../../util/discord-constants.js';

const narrateCommand: CommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'narrate',
		description: '',
		type: ApplicationCommandType.ChatInput,
		options: [
			{
				name: 'story',
				description: '',
				type: ApplicationCommandOptionType.String,
				required: true,
				max_length: MESSAGE_CONTENT_CHARACTER_LIMIT
			}
		]
	},
	async execute(interaction) {
		const storyText = interaction.options.getString('story');
		await interaction.reply({
			content: storyText,
			// We could try to find out which roles the member is allowed to ping in a complicated way
			// but it's easier to just restrict it to none.
			allowedMentions: {
				parse: []
			}
		});
	}
};

export default narrateCommand;
