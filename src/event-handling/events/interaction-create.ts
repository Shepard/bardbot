import {
	BaseInteraction,
	ApplicationCommandType,
	CommandInteraction,
	AutocompleteInteraction,
	MessageComponentInteraction,
	ModalSubmitInteraction
} from 'discord.js';
import { ClientEventHandler } from '../event-handler-types.js';
import { getGuildConfig } from '../../storage/guild-config-dao.js';
import { commands } from '../../command-handling/command-registry.js';
import { CommandModule, isGuardedCommand } from '../../command-handling/command-module-types.js';
import { getTranslatorForInteraction, translate } from '../../util/i18n.js';
import logger from '../../util/logger.js';
import { errorReply } from '../../util/interaction-util.js';
import { InteractionExecutionContext } from '../../util/interaction-types.js';

const interactionCreateEvent: ClientEventHandler<'interactionCreate'> = {
	name: 'interactionCreate',
	execute(interaction: BaseInteraction) {
		handleInteraction(interaction).catch(e => logger.error(e));
	}
};

async function handleInteraction(interaction: BaseInteraction) {
	if (interaction.isChatInputCommand() || interaction.isContextMenuCommand() || interaction.isAutocomplete()) {
		const command = commands.get(interaction.commandName);
		if (command) {
			if (isMatchingCommand(interaction, command)) {
				const context = getExecutionContext(interaction, command);
				if (!isGuardedCommand(command)) {
					await executeCommand(command, interaction, context);
				} else if (command.guard(context.guildConfig, context.logger, interaction.client)) {
					await executeCommand(command, interaction, context);
				} else {
					context.logger.error('Command was called in guild that it should not apply to.');
					await commandExecutionErrorReply(interaction, context);
				}
			} else if (interaction.isAutocomplete() && command.configuration.type === ApplicationCommandType.ChatInput) {
				// We probably don't need to guard the autocomplete.
				const context = getExecutionContext(interaction, command);
				await autocompleteCommandOption(command, interaction, context);
			}
		}
	} else if (interaction.isModalSubmit()) {
		await handleComponent(interaction, true);
	} else if (interaction.isButton() || interaction.isStringSelectMenu()) {
		await handleComponent(interaction, false);
	}
}

function isMatchingCommand(interaction: BaseInteraction, command: CommandModule): interaction is CommandInteraction {
	if (interaction.isChatInputCommand()) {
		return command.configuration.type === ApplicationCommandType.ChatInput;
	}
	if (interaction.isContextMenuCommand()) {
		return (
			(interaction.commandType === ApplicationCommandType.User &&
				command.configuration.type === ApplicationCommandType.User) ||
			(interaction.commandType === ApplicationCommandType.Message &&
				command.configuration.type === ApplicationCommandType.Message)
		);
	}
	return false;
}

function getExecutionContext(interaction: BaseInteraction, command: CommandModule): InteractionExecutionContext {
	const interactionLogger = logger.child({ interactionId: interaction.id, guildId: interaction.guildId });
	const guildConfig = getGuildConfig(interaction.guildId, interactionLogger);
	const t = getTranslatorForInteraction(interaction, command, guildConfig);
	return {
		guildConfig,
		t,
		logger: interactionLogger
	};
}

async function executeCommand(
	command: CommandModule,
	interaction: CommandInteraction,
	context: InteractionExecutionContext
) {
	try {
		await command.execute(interaction, context);
	} catch (error) {
		context.logger.error(error, 'Error while executing command %s', interaction.commandName);
		await commandExecutionErrorReply(interaction, context);
	}
}

async function autocompleteCommandOption(
	command: CommandModule,
	interaction: AutocompleteInteraction,
	context: InteractionExecutionContext
) {
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

async function handleComponent(interaction: ModalSubmitInteraction | MessageComponentInteraction, isModal: boolean) {
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
					await command.modalInteraction(interaction as ModalSubmitInteraction, innerCustomId, context);
				} else {
					await command.componentInteraction(interaction as MessageComponentInteraction, innerCustomId, context);
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

async function commandExecutionErrorReply(
	interaction: CommandInteraction | ModalSubmitInteraction | MessageComponentInteraction,
	context: InteractionExecutionContext
) {
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
