import { Constants } from 'discord.js';
import { getGuildConfig } from '../storage/guild-config-dao.js';
import { commands } from '../command-handling/command-registry.js';
import { getTranslatorForInteraction, translate } from '../util/i18n.js';
import logger from '../util/logger.js';

const interactionCreateEvent = {
	name: 'interactionCreate',
	execute(interaction) {
		handleInteraction(interaction).catch(e => logger.error(e));
	}
};

async function handleInteraction(interaction) {
	if (interaction.isCommand() || interaction.isContextMenu() || interaction.isAutocomplete()) {
		const command = commands.get(interaction.commandName);
		if (command) {
			if (isMatchingCommand(interaction, command)) {
				const context = getExecutionContext(interaction, command);
				if (!command.guard) {
					await executeCommand(command, interaction, context);
				} else if (command.guard(interaction.client, interaction.guild, context.guildConfig, context.logger)) {
					await executeCommand(command, interaction, context);
				} else {
					context.logger.error('Command was called in guild that it should not apply to.');
				}
			} else if (
				interaction.isAutocomplete() &&
				command.configuration.type === Constants.ApplicationCommandTypes.CHAT_INPUT
			) {
				// We probably don't need to guard the autocomplete.
				const context = getExecutionContext(interaction, command);
				await autocompleteCommandOption(command, interaction, context);
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

function getExecutionContext(interaction, command) {
	const interactionLogger = logger.child({ interactionId: interaction.id, guildId: interaction.guildId });
	const guildConfig = getGuildConfig(interaction.guildId, interactionLogger);
	const t = getTranslatorForInteraction(interaction, command, guildConfig);
	return {
		guildConfig,
		t,
		logger: interactionLogger
	};
}

async function executeCommand(command, interaction, context) {
	try {
		await command.execute(interaction, context);
	} catch (error) {
		context.logger.error(error, 'Error while executing command %s', interaction.commandName);

		// Tell the user who used the command (and only them) that the command failed.
		try {
			const userLocale = interaction.locale ?? 'en';
			const content = translate('interaction.error', { lng: userLocale });
			if (interaction.replied) {
				await interaction.followUp({
					content,
					ephemeral: true
				});
			} else {
				if (interaction.deferred) {
					// In this case we can't guarantee that the original .deferReply() call was ephemeral
					// and we can't edit it to be ephemeral after the fact either.
					// So we delete the initial deferred reply and have to use a follow-up in order to send an ephemeral message.
					await interaction.deleteReply();
					await interaction.followUp({
						content,
						ephemeral: true
					});
				} else {
					await interaction.reply({
						content,
						ephemeral: true
					});
				}
			}
		} catch (innerError) {
			context.logger.error(innerError, 'Error while trying to tell user about the previous error');
		}
	}
}

async function autocompleteCommandOption(command, interaction, context) {
	if (command.autocomplete) {
		try {
			const options = await command.autocomplete(interaction, context);
			await interaction.respond(options);
			return;
		} catch (error) {
			context.logger.error(error, 'Error while running option autocomplete for command %s', interaction.commandName);
		}
	}
	try {
		await interaction.respond([]);
	} catch (error) {
		context.logger.error(
			error,
			'Error while trying to respond with empty options for autocomplete for command %s',
			interaction.commandName
		);
	}
}

export default interactionCreateEvent;
