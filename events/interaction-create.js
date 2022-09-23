import { Constants } from 'discord.js';
import { getGuildConfig } from '../storage/guild-config-dao.js';
import { commands } from '../command-handling/command-registry.js';
import { getTranslatorForInteraction, translate } from '../util/i18n.js';
import logger from '../util/logger.js';
import { errorReply } from '../util/interaction-util.js';

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
	} else if (interaction.isModalSubmit()) {
		await handleComponent(interaction, true);
	} else if (interaction.isButton() || interaction.isSelectMenu()) {
		await handleComponent(interaction, false);
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
		await commandExecutionErrorReply(interaction, context);
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

async function handleComponent(interaction, isModal) {
	const customId = interaction.customId;
	if (customId.startsWith('/')) {
		// While the # character can technically appear in the names of context menu commands,
		// we reserve it for this special purpose and try to avoid using it in command names.
		let commandNameEnd = customId.indexOf('#');
		if (commandNameEnd === -1) {
			commandNameEnd = customId.length;
		}
		const commandName = customId.substring(1, commandNameEnd);
		const innerCustomId = customId.substring(commandNameEnd + 1);
		const command = commands.get(commandName);
		if (command && ((isModal && command.modalInteraction) || (!isModal && command.componentInteraction))) {
			const context = getExecutionContext(interaction, command);
			try {
				if (isModal) {
					await command.modalInteraction(interaction, innerCustomId, context);
				} else {
					await command.componentInteraction(interaction, innerCustomId, context);
				}
			} catch (error) {
				context.logger.error(
					error,
					'Error while handling component interaction "%s" for command %s',
					customId,
					commandName
				);
				await commandExecutionErrorReply(interaction, context);
			}
			return;
		}
	}

	// Could not route custom id to any command. For now we don't have any other way of reacting to it,
	// so just send a generic error to the user.
	try {
		logger.warn('Could not find command to route custom id "%s" of component interaction to.', customId);

		const userLocale = interaction.locale ?? 'en';
		await interaction.reply({
			content: translate('shared.unknown-command', { lng: userLocale }),
			ephemeral: true
		});
	} catch (innerError) {
		logger.error(innerError, 'Error while trying to tell user about the previous error');
	}
}

async function commandExecutionErrorReply(interaction, context) {
	// Tell the user who used the command (and only them) that the command failed.
	try {
		const userLocale = interaction.locale ?? 'en';
		const text = translate('interaction.error', { lng: userLocale });
		await errorReply(interaction, text, null, true);
	} catch (innerError) {
		context.logger.error(innerError, 'Error while trying to tell user about the previous error');
	}
}

export default interactionCreateEvent;
