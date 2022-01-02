import { Constants } from 'discord.js';
import { getGuildConfig } from '../storage/guild-config-dao.js';
import { commands } from '../command-handling/command-registry.js';

const interactionCreateEvent = {
	name: 'interactionCreate',
	execute(interaction) {
		handleInteraction(interaction).catch(e => console.error(e));
	}
};

async function handleInteraction(interaction) {
	if (interaction.isCommand() || interaction.isContextMenu() || interaction.isAutocomplete()) {
		const command = commands.get(interaction.commandName);
		if (command) {
			if (isMatchingCommand(interaction, command)) {
				const guildConfig = getGuildConfig(interaction.guildId);
				if (!command.guard) {
					await executeCommand(command, interaction, guildConfig);
				} else if (command.guard(interaction.client, interaction.guild, guildConfig)) {
					await executeCommand(command, interaction, guildConfig);
				} else {
					console.error('Command was called in guild that it should not apply to.');
				}
			} else if (
				interaction.isAutocomplete() &&
				command.configuration.type === Constants.ApplicationCommandTypes.CHAT_INPUT
			) {
				// We probably don't need to guard the autocomplete.
				const guildConfig = getGuildConfig(interaction.guildId);
				await autocompleteCommandOption(command, interaction, guildConfig);
			}
		}
	}
}

function isMatchingCommand(interaction, command) {
	if (interaction.isCommand()) {
		return command.configuration.type === Constants.ApplicationCommandTypes.CHAT_INPUT;
	}
	if (interaction.isContextMenu()) {
		return (
			(interaction.targetType === 'USER' && command.configuration.type === Constants.ApplicationCommandTypes.USER) ||
			(interaction.targetType === 'MESSAGE' && command.configuration.type === Constants.ApplicationCommandTypes.MESSAGE)
		);
	}
	return false;
}

async function executeCommand(command, interaction, guildConfig) {
	try {
		await command.execute(interaction, guildConfig);
	} catch (error) {
		console.error(`Error while executing command '${interaction.commandName}':`, error);
		// Tell the user who used the command (and only them) that the command failed.
		try {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		} catch (innerError) {
			console.error('Error while trying to tell user about the previous error:', innerError);
		}
	}
}

async function autocompleteCommandOption(command, interaction, guildConfig) {
	if (command.autocomplete) {
		try {
			const options = await command.autocomplete(interaction, guildConfig);
			await interaction.respond(options);
			return;
		} catch (error) {
			console.error(`Error while running option autocomplete for command '${interaction.commandName}':`, error);
		}
	}
	try {
		await interaction.respond([]);
	} catch (error) {
		console.error(
			`Error while trying to respond with empty options for autocomplete for command '${interaction.commandName}':`,
			error
		);
	}
}

export default interactionCreateEvent;
