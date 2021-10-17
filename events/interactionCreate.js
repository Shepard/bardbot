import { Constants } from 'discord.js';

const interactionCreateEvent = {
	name: 'interactionCreate',
	async execute(interaction) {
		if (interaction.isCommand() || interaction.isContextMenu()) {
			const { commandName, client } = interaction;
			const command = client.commands.get(interaction.commandName);
			if (command && isMatchingCommand(interaction, command)) {
				try {
					await command.execute(interaction);
				} catch (error) {
					console.error(error);
					// Tell the user who used the command (and only them) that the command failed.
					await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
				}
			}
		}
	},
};

function isMatchingCommand(interaction, command) {
	if (interaction.isCommand()) {
		return command.type === Constants.ApplicationCommandTypes.CHAT_INPUT;
	}
	if (interaction.isContextMenu()) {
		return (interaction.targetType === 'USER' && command.data.type === Constants.ApplicationCommandTypes.USER)
			|| (interaction.targetType === 'MESSAGE' && command.data.type === Constants.ApplicationCommandTypes.MESSAGE);
	}
}

export default interactionCreateEvent;