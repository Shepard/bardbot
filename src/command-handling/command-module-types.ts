import {
	Client,
	Guild,
	CommandInteraction,
	ChatInputCommandInteraction,
	AutocompleteInteraction,
	ApplicationCommandOptionChoiceData,
	ModalSubmitInteraction,
	MessageComponentInteraction,
	ChatInputApplicationCommandData,
	MessageApplicationCommandData,
	UserApplicationCommandData,
	UserContextMenuCommandInteraction,
	MessageContextMenuCommandInteraction,
	ApplicationCommandData
} from 'discord.js';
import { Logger } from 'pino';
import { GuildConfiguration } from '../storage/record-types.js';
import { InteractionExecutionContext } from '../util/interaction-types.js';

/**
 * The type of configuration data in a command module depends on the type of interaction it can accept.
 * When the CommandModule type is used in its generic form (with its fallback to CommandInteraction in its type parameter),
 * then all kinds of ApplicationCommandData are accepted.
 */
type CommandConfiguration<I extends CommandInteraction> = I extends ChatInputCommandInteraction
	? ChatInputApplicationCommandData
	: I extends UserContextMenuCommandInteraction
	? UserApplicationCommandData
	: I extends MessageContextMenuCommandInteraction
	? MessageApplicationCommandData
	: ApplicationCommandData;

export interface CommandModule<I extends CommandInteraction = CommandInteraction> {
	/**
	 * Configuration for registering the command
	 */
	configuration?: CommandConfiguration<I>;
	/**
	 * In some cases the configuration cannot be created at the same time as the module but needs to wait for some data to become available later.
	 * In that case, this function can be defined to provide a way to generate the configuration later on and attach it to the module.
	 */
	getConfiguration?: () => CommandConfiguration<I>;

	/**
	 * Normally, the name of the command (in the configuration) is used as a key prefix for looking up translations within the command execution.
	 * In some situations, the name may not be suitable as a key (e.g. for context menu commands where the name is more a readable phrase than an identifier).
	 * In that case this property can be defined as an override for the key prefix.
	 */
	i18nKeyPrefix?: string;

	/**
	 * Provides a similar key prefix override to i18nKeyPrefix but for the sole purpose of translating the name of the command.
	 */
	commandNameKeyPrefixOverride?: string;

	/**
	 * Handler for when the command is used (a command interaction is received)
	 */
	execute: (interaction: I, context: InteractionExecutionContext) => Promise<void>;

	/**
	 * Handler for autocomplete interactions received for some option of this command
	 */
	autocomplete?: (
		interaction: AutocompleteInteraction,
		context: InteractionExecutionContext
	) => Promise<ApplicationCommandOptionChoiceData[]>;

	/**
	 * Handler for interactions from modals being submitted that have been routed to this command via their custom id
	 */
	modalInteraction?: (
		interaction: ModalSubmitInteraction,
		innerCustomId: string,
		context: InteractionExecutionContext
	) => Promise<void>;

	/**
	 * Handler for message component interactions that have been routed to this command via the custom id on the component
	 */
	componentInteraction?: (
		interaction: MessageComponentInteraction,
		innerCustomId: string,
		context: InteractionExecutionContext
	) => Promise<void>;
}

export interface GuildCommandModule<I extends CommandInteraction = CommandInteraction> extends CommandModule<I> {
	/**
	 * Test function to check if the command should apply to a guild
	 */
	guard: (client: Client, guild: Guild, guildConfig: GuildConfiguration, logger: Logger) => boolean;
}

export function isGuardedCommand<I extends CommandInteraction>(
	command: CommandModule<I>
): command is GuildCommandModule<I> {
	return (command as GuildCommandModule<I>).guard !== undefined;
}
