import { Constants } from 'discord.js';
import { MESSAGE_CONTENT_CHARACTER_LIMIT } from '../util/discord-constants.js';

const narrateCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'narrate',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'story',
				type: Constants.ApplicationCommandOptionTypes.STRING,
				required: true,
				max_length: MESSAGE_CONTENT_CHARACTER_LIMIT
			}
		]
	},
	// Handler for when the command is used
	async execute(interaction) {
		const storyText = interaction.options.getString('story');
		await interaction.reply({
			content: storyText,
			// We could try to find out which roles the member is allowed to ping in a complicated way
			// but it's easier to just restrict it to none.
			allowed_mentions: {
				parse: []
			}
		});
	}
};

export default narrateCommand;
