import {
	ApplicationCommandType,
	ApplicationCommandOptionType,
	PermissionFlagsBits,
	EmbedBuilder,
	userMention,
	roleMention,
	ChatInputCommandInteraction
} from 'discord.js';
import { Logger } from 'pino';
import { CommandModule } from '../command-module-types.js';
import { ContextTranslatorFunctions } from '../../util/interaction-types.js';
import { Alt, UsableByType } from '../../storage/record-types.js';
import { addAlt, findMatchingAlts, getAlt, getAlts, editAlt, deleteAlt } from '../../storage/alt-dao.js';
import getRandomAvatarUrl from '../../util/random-avatar-provider.js';
import { validateWebhookName } from '../../util/webhook-util.js';
import { updateCommandsAfterConfigChange } from './config.js';
import { WEBHOOK_NAME_CHARACTER_LIMIT, AUTOCOMPLETE_CHOICE_LIMIT } from '../../util/discord-constants.js';
import { errorReply, sendListReply, warningReply } from '../../util/interaction-util.js';

const configAltCommand: CommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'config-alt',
		description: '',
		type: ApplicationCommandType.ChatInput,
		defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
		options: [
			{
				name: 'add',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'name',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: true,
						min_length: 1,
						max_length: WEBHOOK_NAME_CHARACTER_LIMIT
					},
					{
						name: 'usable-by',
						description: '',
						type: ApplicationCommandOptionType.Mentionable,
						required: true
					},
					{
						name: 'avatar-url',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: false
					}
				]
			},
			{
				name: 'edit',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'name',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: true,
						autocomplete: true
					},
					{
						name: 'new-name',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: false,
						min_length: 1,
						max_length: WEBHOOK_NAME_CHARACTER_LIMIT
					},
					{
						name: 'usable-by',
						description: '',
						type: ApplicationCommandOptionType.Mentionable,
						required: false
					},
					{
						name: 'avatar-url',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: false
					}
				]
			},
			{
				name: 'delete',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'name',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: true,
						autocomplete: true
					}
				]
			},
			{
				name: 'show',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'name',
						description: '',
						type: ApplicationCommandOptionType.String,
						required: false,
						autocomplete: true
					}
				]
			}
		]
	},
	async execute(interaction, { t, logger }) {
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'add') {
			await handleAddAlt(interaction, t, logger);
		} else if (subcommand === 'edit') {
			await handleEditAlt(interaction, t, logger);
		} else if (subcommand === 'delete') {
			await handleDeleteAlt(interaction, t, logger);
		} else if (subcommand === 'show') {
			await handleShowAlts(interaction, t, logger);
		} else {
			await warningReply(interaction, t.userShared('unknown-command'));
		}
	},
	async autocomplete(interaction, { logger }) {
		const focusedOption = interaction.options.getFocused(true);
		if (focusedOption.name === 'name') {
			const matchingAlts = findMatchingAlts(interaction.guildId, focusedOption.value, logger);
			let result = matchingAlts.map(alt => ({ name: alt.name, value: alt.name }));
			// Limit to the maximum number of results Discord accepts.
			result = result.slice(0, Math.min(result.length, AUTOCOMPLETE_CHOICE_LIMIT + 1));
			// The database already does some sorting for us but it's not very good at proper i18n sorting.
			const collator = new Intl.Collator(interaction.locale);
			result = result.sort((a, b) => collator.compare(a?.name, b?.name));
			return result;
		} else {
			return [];
		}
	}
};

async function handleAddAlt(interaction: ChatInputCommandInteraction, t: ContextTranslatorFunctions, logger: Logger) {
	const guildId = interaction.guildId;

	const name = interaction.options.getString('name', true).trim();
	const errorMessageKey = validateWebhookName(name);
	if (errorMessageKey) {
		await errorReply(interaction, t.userShared(errorMessageKey));
		return;
	}

	const usableByOption = interaction.options.get('usable-by', true);
	const usableById = usableByOption.value as string;
	const usableByType = usableByOption.user ? UsableByType.User : UsableByType.Role;

	let avatarUrl = interaction.options.getString('avatar-url');
	// If no avatar was provided by the user, pick a random fallback image.
	if (!avatarUrl) {
		avatarUrl = getRandomAvatarUrl();
	}

	try {
		const id = addAlt(guildId, name, usableById, usableByType, avatarUrl);
		logger.info('An alt with the id %d and the name "%s" was created in guild %s.', id, name, guildId);
	} catch (e) {
		if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
			await warningReply(interaction, t.user('reply.alt-exists', { name, command: '/config-alt edit', guildId }));
		} else {
			logger.error(e, 'Error while trying to create alt in db');
			await errorReply(interaction, t.user('reply.add-failure'));
		}
		return;
	}

	// Tell user about successful creation and show the alt data off a bit.
	const usableByMention = usableByType === UsableByType.User ? userMention(usableById) : roleMention(usableById);
	const altEmbed = new EmbedBuilder()
		.setAuthor({ name, iconURL: avatarUrl })
		.addFields({ name: t.user('field-usable-by'), value: usableByMention });
	await interaction.reply({
		content: t.user('reply.add-success'),
		embeds: [altEmbed],
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction, logger);
}

async function handleEditAlt(interaction: ChatInputCommandInteraction, t: ContextTranslatorFunctions, logger: Logger) {
	const guildId = interaction.guildId;

	// Try to find the existing alt by the provided name.
	const name = interaction.options.getString('name', true);
	let alt: Alt = null;
	try {
		alt = getAlt(guildId, name);
	} catch (e) {
		logger.error(e, 'Error while trying to fetch alt from db');
		await errorReply(interaction, t.userShared('alt-db-fetch-error'));
		return;
	}
	if (!alt) {
		await warningReply(interaction, t.userShared('no-alt-with-name', { altName: name }));
		return;
	}

	// Get an updated object to store in the database.
	const patchedAlt = await getPatchedAlt(alt, interaction, t);
	if (!patchedAlt) {
		// getPatchedAlt already handled telling the user about it.
		return;
	}

	try {
		editAlt(patchedAlt);
		if (name !== patchedAlt.name) {
			logger.info(
				'An alt with the id %d and the name "%s" was updated in guild %s. The new name is "%s".',
				patchedAlt.id,
				name,
				guildId,
				patchedAlt.name
			);
		}
	} catch (e) {
		logger.error(e, 'Error while trying to edit alt in db');
		await errorReply(interaction, t.user('reply.edit-failure'));
		return;
	}

	const usableByMention =
		patchedAlt.usableByType === UsableByType.User
			? userMention(patchedAlt.usableById)
			: roleMention(patchedAlt.usableById);
	const altEmbed = new EmbedBuilder()
		.setAuthor({ name: patchedAlt.name, iconURL: patchedAlt.avatarUrl })
		.addFields({ name: t.user('field-usable-by'), value: usableByMention });
	await interaction.reply({
		content: t.user('reply.edit-success'),
		embeds: [altEmbed],
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction, logger);
}

async function handleDeleteAlt(
	interaction: ChatInputCommandInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	const guildId = interaction.guildId;
	const name = interaction.options.getString('name', true);

	try {
		const deleted = deleteAlt(guildId, name);
		if (deleted) {
			logger.info('An alt with the name "%s" was deleted in guild %s.', name, guildId);
			await t.privateReply(interaction, 'reply.delete-success', { name });

			await updateCommandsAfterConfigChange(interaction, logger);
		} else {
			await warningReply(interaction, t.userShared('no-alt-with-name', { altName: name }));
		}
	} catch (e) {
		logger.error(e);
		await errorReply(interaction, t.user('reply.delete-failure', { name }));
	}
}

async function handleShowAlts(interaction: ChatInputCommandInteraction, t: ContextTranslatorFunctions, logger: Logger) {
	const guildId = interaction.guildId;
	const name = interaction.options.getString('name');

	if (name) {
		let alt: Alt = null;
		try {
			alt = getAlt(guildId, name);
		} catch (e) {
			logger.error(e, 'Error while trying to fetch alt from db');
			await errorReply(interaction, t.userShared('alt-db-fetch-error'));
			return;
		}
		if (!alt) {
			await warningReply(interaction, t.userShared('no-alt-with-name', { altName: name }));
			return;
		}

		const usableByMention =
			alt.usableByType === UsableByType.User ? userMention(alt.usableById) : roleMention(alt.usableById);
		const altEmbed = new EmbedBuilder()
			.setAuthor({ name: alt.name, iconURL: alt.avatarUrl })
			.addFields({ name: t.user('field-usable-by'), value: usableByMention });
		await interaction.reply({
			embeds: [altEmbed],
			ephemeral: true
		});
	} else {
		let alts: Alt[] = null;
		try {
			alts = getAlts(guildId);
		} catch (e) {
			logger.error(e, 'Error while trying to fetch alts from db');
			await errorReply(interaction, t.user('reply.show-alts-failure'));
			return;
		}
		const collator = new Intl.Collator(interaction.locale);
		const altNameList = alts
			.map(alt => alt.name)
			// The database already does some sorting for us but it's not very good at proper i18n sorting.
			.sort(collator.compare);
		await sendListReply(interaction, altNameList, t.user('reply.show-alts'), false, true);
		// TODO if <= 25, show them in a select, like for stories
	}
}

async function getPatchedAlt(alt: Alt, interaction: ChatInputCommandInteraction, t: ContextTranslatorFunctions) {
	const patchedAlt: Alt = { ...alt };

	let newName = interaction.options.getString('new-name');
	if (newName) {
		newName = newName.trim();
		const errorMessageKey = validateWebhookName(newName);
		if (errorMessageKey) {
			await t.privateReplyShared(interaction, errorMessageKey);
			return null;
		}

		patchedAlt.name = newName;
	}

	const usableByOption = interaction.options.get('usable-by');
	if (usableByOption) {
		const usableById = usableByOption.value as string;
		if (usableById) {
			const usableByType = usableByOption.user ? UsableByType.User : UsableByType.Role;
			patchedAlt.usableById = usableById;
			patchedAlt.usableByType = usableByType;
		}
	}

	const avatarUrl = interaction.options.getString('avatar-url');
	if (avatarUrl) {
		patchedAlt.avatarUrl = avatarUrl;
	}

	return patchedAlt;
}

export default configAltCommand;
