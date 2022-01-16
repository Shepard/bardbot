import { Constants, Permissions, MessageEmbed } from 'discord.js';
import { userMention, roleMention } from '@discordjs/builders';
import { UsableByType, addAlt, findMatchingAlts, getAlt, getAlts, editAlt, deleteAlt } from '../storage/alt-dao.js';
import getRandomAvatarUrl from '../util/random-avatar-provider.js';
import { validateWebhookName } from '../util/webhook-util.js';
import { updateCommandsAfterConfigChange } from './config.js';

const configAltCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'config-alt',
		description: 'Configure an alternate character.',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'add',
				description: 'Add a new alternate character.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'name',
						description: 'The name of the alternate character to create. Needs to be unique.',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true
					},
					{
						name: 'usable-by',
						description: 'A user or role who is allowed to use this alternate character.',
						type: Constants.ApplicationCommandOptionTypes.MENTIONABLE,
						required: true
					},
					{
						name: 'avatar-url',
						description: 'A URL pointing to an image file to be used as the avatar of the alternate character.',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false
					}
				]
			},
			{
				name: 'edit',
				description: 'Change some properties of an alternate character.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'name',
						description: 'The name of the existing alternate character to edit.',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						autocomplete: true
					},
					{
						name: 'new-name',
						description: 'A new name for the alternate character. Needs to be unique.',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false
					},
					{
						name: 'usable-by',
						description: 'A user or role who is allowed to use this alternate character.',
						type: Constants.ApplicationCommandOptionTypes.MENTIONABLE,
						required: false
					},
					{
						name: 'avatar-url',
						description: 'A URL pointing to an image file to be used as the avatar of the alternate character.',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false
					}
				]
			},
			{
				name: 'delete',
				description: 'Delete an alternate character. It will not be usable anymore but old messages stay.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'name',
						description: 'The name of the existing alternate character to delete.',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						autocomplete: true
					}
				]
			},
			{
				name: 'show',
				description: 'List currently configured alternate characters.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'name',
						description: 'The name of an alternate character to show. If left out, lists all characters.',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: false,
						autocomplete: true
					}
				]
			}
		]
	},
	// Command is only usable by users in roles that have the Administrator flag set.
	// Until Discord implements the new command permission system, this means that the server owner
	// can't use the command without explicitly having an admin role.
	permissions: [Permissions.FLAGS.ADMINISTRATOR],
	// Handler for when the command is used
	async execute(interaction, t) {
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'add') {
			await handleAddAlt(interaction, t);
		} else if (subcommand === 'edit') {
			await handleEditAlt(interaction, t);
		} else if (subcommand === 'delete') {
			await handleDeleteAlt(interaction, t);
		} else if (subcommand === 'show') {
			await handleShowAlts(interaction, t);
		} else {
			await t.privateReplyShared(interaction, 'unknown-command');
		}
	},
	async autocomplete(interaction) {
		const focusedOption = interaction.options.getFocused(true);
		if (focusedOption.name === 'name') {
			const collator = new Intl.Collator(interaction.locale);
			const matchingAlts = findMatchingAlts(interaction.guildId, focusedOption.value);
			return (
				matchingAlts
					.map(alt => ({ name: alt.name, value: alt.name }))
					// The database already does some sorting for us but it's not very good at proper i18n sorting.
					.sort((a, b) => collator.compare(a?.name, b?.name))
			);
		} else {
			return [];
		}
	}
};

async function handleAddAlt(interaction, t) {
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
		console.debug(`An alt with the id ${id} and the name "${name}" was created in guild ${guildId}.`);
	} catch (e) {
		if (e.message?.includes('UNIQUE constraint failed')) {
			await t.privateReply(interaction, 'reply.alt-exists', { name });
		} else {
			console.error('Error while trying to create alt in db:', e);
			await t.privateReply(interaction, 'reply.add-failure');
		}
		return;
	}

	// Tell user about successful creation and show the alt data off a bit.
	const usableByMention = usableByType === UsableByType.User ? userMention(usableById) : roleMention(usableById);
	const altEmbed = new MessageEmbed()
		.setAuthor({ name, iconURL: avatarUrl })
		.addField(t.user('field-usable-by'), usableByMention);
	await interaction.reply({
		content: t.user('reply.add-success'),
		embeds: [altEmbed],
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction, t);
}

async function handleEditAlt(interaction, t) {
	const guildId = interaction.guildId;

	// Try to find the existing alt by the provided name.
	const name = interaction.options.getString('name', true);
	let alt = null;
	try {
		alt = getAlt(guildId, name);
	} catch (e) {
		console.error('Error while trying to fetch alt from db:', e);
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
			console.debug(
				`An alt with the id ${patchedAlt.id} and the name "${name}" was updated in guild ${guildId}. The new name is "${patchedAlt.name}".`
			);
		}
	} catch (e) {
		console.error('Error while trying to edit alt in db:', e);
		await t.privateReply(interaction, 'reply.edit-failure');
		return;
	}

	const usableByMention =
		patchedAlt.usableByType === UsableByType.User
			? userMention(patchedAlt.usableById)
			: roleMention(patchedAlt.usableById);
	const altEmbed = new MessageEmbed()
		.setAuthor({ name: patchedAlt.name, iconURL: patchedAlt.avatarUrl })
		.addField(t.user('field-usable-by'), usableByMention);
	await interaction.reply({
		content: t.user('reply.edit-success'),
		embeds: [altEmbed],
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction, t);
}

async function handleDeleteAlt(interaction, t) {
	const guildId = interaction.guildId;
	const name = interaction.options.getString('name', true);

	try {
		const deleted = deleteAlt(guildId, name);
		if (deleted) {
			console.debug(`An alt with the name "${name}" was deleted in guild ${guildId}.`);
			await t.privateReply(interaction, 'reply.delete-success', { name });

			await updateCommandsAfterConfigChange(interaction, t);
		} else {
			await t.privateReplyShared(interaction, 'no-alt-with-name', { altName: name });
		}
	} catch (e) {
		console.error(e);
		await t.privateReply(interaction, 'reply.delete-failure', { name });
	}
}

async function handleShowAlts(interaction, t) {
	const guildId = interaction.guildId;
	const name = interaction.options.getString('name');

	if (name) {
		let alt = null;
		try {
			alt = getAlt(guildId, name);
		} catch (e) {
			console.error('Error while trying to fetch alt from db:', e);
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
			.addField(t.user('field-usable-by'), usableByMention);
		await interaction.reply({
			embeds: [altEmbed],
			ephemeral: true
		});
	} else {
		let alts = null;
		try {
			alts = getAlts(guildId);
		} catch (e) {
			console.error('Error while trying to fetch alts from db:', e);
			await t.privateReply(interaction, 'reply.show-alts-failure');
			return;
		}
		const collator = new Intl.Collator(interaction.locale);
		const altNameList = alts
			.map(alt => alt.name)
			// The database already does some sorting for us but it's not very good at proper i18n sorting.
			.sort(collator.compare)
			.join('\n');
		await interaction.reply({
			content: t.user('reply.show-alts') + '\n\n' + altNameList,
			ephemeral: true
		});
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
