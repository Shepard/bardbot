import {
	ApplicationCommandChannelOptionData,
	ApplicationCommandChoicesData,
	ApplicationCommandData,
	ApplicationCommandNumericOptionData,
	ApplicationCommandOptionData,
	ApplicationCommandOptionType,
	ApplicationCommandStringOptionData,
	ApplicationCommandSubCommand,
	BaseApplicationCommandOptionsData,
	ChatInputApplicationCommandData,
	PermissionsBitField
} from 'discord.js';

/**
 * Turns Discord.JS ApplicationCommandData objects into data the Discord API expects for commands.
 */
export function transformCommandConfigurations(commands: ApplicationCommandData[]) {
	return commands.map(command => transformCommandConfiguration(command));
}

function transformCommandConfiguration(command: ApplicationCommandData) {
	const default_member_permissions =
		command.defaultMemberPermissions !== null
			? new PermissionsBitField(command.defaultMemberPermissions).bitfield.toString()
			: null;

	return {
		name: command.name,
		name_localizations: command.nameLocalizations,
		description: (command as ChatInputApplicationCommandData).description ?? '',
		description_localizations: (command as ChatInputApplicationCommandData).descriptionLocalizations ?? null,
		type: command.type,
		options: (command as ChatInputApplicationCommandData).options?.map(o => transformOption(o)) ?? null,
		default_member_permissions,
		dm_permission: command.dmPermission
	};
}

export function transformOption(option: ApplicationCommandOptionData) {
	return {
		type: option.type,
		name: option.name,
		name_localizations: option.nameLocalizations,
		description: option.description,
		description_localizations: option.descriptionLocalizations,
		required:
			(option as BaseApplicationCommandOptionsData).required ??
			(option.type === ApplicationCommandOptionType.Subcommand ||
			option.type === ApplicationCommandOptionType.SubcommandGroup
				? undefined
				: false),
		autocomplete: option.autocomplete,
		choices:
			(option as ApplicationCommandChoicesData).choices?.map(choice => ({
				name: choice.name,
				name_localizations: choice.nameLocalizations,
				value: choice.value
			})) ?? null,
		options: (option as ApplicationCommandSubCommand).options?.map(o => transformOption(o)) ?? null,
		channel_types:
			(option as ApplicationCommandChannelOptionData).channelTypes ??
			(option as ApplicationCommandChannelOptionData).channel_types,
		min_value:
			(option as ApplicationCommandNumericOptionData).minValue ??
			(option as ApplicationCommandNumericOptionData).min_value,
		max_value:
			(option as ApplicationCommandNumericOptionData).maxValue ??
			(option as ApplicationCommandNumericOptionData).max_value,
		min_length:
			(option as ApplicationCommandStringOptionData).minLength ??
			(option as ApplicationCommandStringOptionData).min_length,
		max_length:
			(option as ApplicationCommandStringOptionData).maxLength ??
			(option as ApplicationCommandStringOptionData).max_length
	};
}
