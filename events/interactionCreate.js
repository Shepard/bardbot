import { Constants } from 'discord.js';

const interactionCreateEvent = {
	name: 'interactionCreate',
	async execute(interaction) {
		if (interaction.isCommand() || interaction.isContextMenu()) {
			const { commandName, client } = interaction;
			const command = client.commands.get(interaction.commandName);
			if (command && isMatchingCommand(interaction, command)) {
				const guildConfig = client.guildConfigs.find(gc => gc.id === interaction.guildId);
				if (!command.guard) {
					await executeCommand(command, interaction, guildConfig);
				} else if (command.guard(client, interaction.guild, guildConfig)) {
					await executeCommand(command, interaction, guildConfig);
				} else {
					console.error('Command was called in guild that it should not apply to.');
				}
			}
		}
	},
};

function isMatchingCommand(interaction, command) {
	if (interaction.isCommand()) {
		return command.data.type === Constants.ApplicationCommandTypes.CHAT_INPUT;
	}
	if (interaction.isContextMenu()) {
		return (interaction.targetType === 'USER' && command.data.type === Constants.ApplicationCommandTypes.USER)
			|| (interaction.targetType === 'MESSAGE' && command.data.type === Constants.ApplicationCommandTypes.MESSAGE);
	}
}

async function executeCommand(command, interaction, guildConfig) {
	try {
		await command.execute(interaction, guildConfig);
	} catch (error) {
		console.error(error);
		// Tell the user who used the command (and only them) that the command failed.
		await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
	}
}

export default interactionCreateEvent;