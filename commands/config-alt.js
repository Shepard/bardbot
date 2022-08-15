import { Constants, Permissions, MessageEmbed } from 'discord.js';
import { userMention, roleMention } from '@discordjs/builders';
import { UsableByType, addAlt, findMatchingAlts, getAlt, getAlts, editAlt, deleteAlt } from '../storage/alt-dao.js';
import getRandomAvatarUrl from '../util/random-avatar-provider.js';
import { validateWebhookName } from '../util/webhook-util.js';
import { updateCommandsAfterConfigChange } from './config.js';
import { WEBHOOK_NAME_CHARACTER_LIMIT, AUTOCOMPLETE_CHOICE_LIMIT } from '../util/discord-constants.js';
import { sendListReply } from '../util/interaction-util.js';

const configAltCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'config-alt',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		defaultMemberPermissions: new Permissions([Permissions.FLAGS.MANAGE_GUILD]),
		options: [
			{
				name: 'add',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'name',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						min_length: 1,
						max_length: WEBHOOK_NAME_CHARACTER_LIMIT
					},
					{
						name: 'usable-by',
						type: Constants.ApplicationCommandOptionTypes.MENTIONABLE,
						required: true
					},
					{
						name: 'avatar-url',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false
					}
				]
			},
			{
				name: 'edit',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'name',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						autocomplete: true
					},
					{
						name: 'new-name',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false,
						min_length: 1,
						max_length: WEBHOOK_NAME_CHARACTER_LIMIT
					},
					{
						name: 'usable-by',
						type: Constants.ApplicationCommandOptionTypes.MENTIONABLE,
						required: false
					},
					{
						name: 'avatar-url',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false
					}
				]
			},
			{
				name: 'delete',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'name',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						autocomplete: true
					}
				]
			},
			{
				name: 'show',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'name',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false,
						autocomplete: true
					}
				]
			}
		]
	},
	// Handler for when the command is used
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
			await t.privateReplyShared(interaction, 'unknown-command');
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

async function handleAddAlt(interaction, t, logger) {
	const guildId = interaction.guildId;

	const name = interaction.options.getString('name', true).trim();
	const errorMessageKey = validateWebhookName(name);
	if (errorMessageKey) {
		await t.privateReplyShared(interaction, errorMessageKey);
		return;
	}

	const usableByOption = interaction.options.get('usable-by', true);
	const usableById = usableByOption.value;
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
		if (e.message?.includes('UNIQUE constraint failed')) {
			await t.privateReply(interaction, 'reply.alt-exists', { name });
		} else {
			logger.error(e, 'Error while trying to create alt in db');
			await t.privateReply(interaction, 'reply.add-failure');
		}
		return;
	}

	// Tell user about successful creation and show the alt data off a bit.
	const usableByMention = usableByType === UsableByType.User ? userMention(usableById) : roleMention(usableById);
	const altEmbed = new MessageEmbed()
		.setAuthor({ name, iconURL: avatarUrl })
		.addFields({ name: t.user('field-usable-by'), value: usableByMention });
	await interaction.reply({
		content: t.user('reply.add-success'),
		embeds: [altEmbed],
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction, t, logger);
}

async function handleEditAlt(interaction, t, logger) {
	const guildId = interaction.guildId;

	// Try to find the existing alt by the provided name.
	const name = interaction.options.getString('name', true);
	let alt = null;
	try {
		alt = getAlt(guildId, name);
	} catch (e) {
		logger.error(e, 'Error while trying to fetch alt from db');
		await t.privateReplyShared(interaction, 'alt-db-fetch-error');
		return;
	}
	if (!alt) {
		await t.privateReplyShared(interaction, 'no-alt-with-name', { altName: name });
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
		await t.privateReply(interaction, 'reply.edit-failure');
		return;
	}

	const usableByMention =
		patchedAlt.usableByType === UsableByType.User
			? userMention(patchedAlt.usableById)
			: roleMention(patchedAlt.usableById);
	const altEmbed = new MessageEmbed()
		.setAuthor({ name: patchedAlt.name, iconURL: patchedAlt.avatarUrl })
		.addFields({ name: t.user('field-usable-by'), value: usableByMention });
	await interaction.reply({
		content: t.user('reply.edit-success'),
		embeds: [altEmbed],
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction, t, logger);
}

async function handleDeleteAlt(interaction, t, logger) {
	const guildId = interaction.guildId;
	const name = interaction.options.getString('name', true);

	try {
		const deleted = deleteAlt(guildId, name);
		if (deleted) {
			logger.info('An alt with the name "%s" was deleted in guild %s.', name, guildId);
			await t.privateReply(interaction, 'reply.delete-success', { name });

			await updateCommandsAfterConfigChange(interaction, t, logger);
		} else {
			await t.privateReplyShared(interaction, 'no-alt-with-name', { altName: name });
		}
	} catch (e) {
		logger.error(e);
		await t.privateReply(interaction, 'reply.delete-failure', { name });
	}
}

async function handleShowAlts(interaction, t, logger) {
	const guildId = interaction.guildId;
	const name = interaction.options.getString('name');

	if (name) {
		let alt = null;
		try {
			alt = getAlt(guildId, name);
		} catch (e) {
			logger.error(e, 'Error while trying to fetch alt from db');
			await t.privateReplyShared(interaction, 'alt-db-fetch-error');
			return;
		}
		if (!alt) {
			await t.privateReplyShared(interaction, 'no-alt-with-name', { altName: name });
			return;
		}

		const usableByMention =
			alt.usableByType === UsableByType.User ? userMention(alt.usableById) : roleMention(alt.usableById);
		const altEmbed = new MessageEmbed()
			.setAuthor({ name: alt.name, iconURL: alt.avatarUrl })
			.addFields({ name: t.user('field-usable-by'), value: usableByMention });
		await interaction.reply({
			embeds: [altEmbed],
			ephemeral: true
		});
	} else {
		let alts = null;
		try {
			alts = getAlts(guildId);
		} catch (e) {
			logger.error(e, 'Error while trying to fetch alts from db');
			await t.privateReply(interaction, 'reply.show-alts-failure');
			return;
		}
		const collator = new Intl.Collator(interaction.locale);
		const altNameList = alts
			.map(alt => alt.name)
			// The database already does some sorting for us but it's not very good at proper i18n sorting.
			.sort(collator.compare);
		await sendListReply(interaction, altNameList, t.user('reply.show-alts'), false, true, false);
	}
}

async function getPatchedAlt(alt, interaction, t) {
	const patchedAlt = { ...alt };

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
		const usableById = usableByOption.value;
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
