import { Constants, Permissions, MessageEmbed } from 'discord.js';
import { inlineCode, userMention, roleMention } from '@discordjs/builders';
import { UsableByType, addAlt, findMatchingAlts, getAlt, getAlts, editAlt, deleteAlt } from '../storage/alt-dao.js';
import getRandomAvatarUrl from '../util/random-avatar-provider.js';
import { validateWebhookName } from '../util/webhook-util.js';

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
	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'add') {
			await handleAddAlt(interaction);
		} else if (subcommand === 'edit') {
			await handleEditAlt(interaction);
		} else if (subcommand === 'delete') {
			await handleDeleteAlt(interaction);
		} else if (subcommand === 'show') {
			await handleShowAlts(interaction);
		} else {
			await interaction.reply({
				content: 'Unknown command',
				ephemeral: true
			});
		}
	},
	async autocomplete(interaction) {
		const focusedOption = interaction.options.getFocused(true);
		if (focusedOption.name === 'name') {
			// Once we can get user locales from interactions, we can use those instead.
			const collator = new Intl.Collator('en');
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

async function handleAddAlt(interaction) {
	const guildId = interaction.guildId;

	const name = interaction.options.getString('name', true).trim();
	const errorMessage = validateWebhookName(name);
	if (errorMessage) {
		await interaction.reply({
			content: errorMessage,
			ephemeral: true
		});
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
			await interaction.reply({
				content: `An alternate character with the name "${name}" already exists. If you want to adjust it, use the ${inlineCode(
					'/config-alt edit'
				)} command.`,
				ephemeral: true
			});
		} else {
			console.error('Error while trying to create alt in db:', e);
			await interaction.reply({
				content: 'Adding the alternate character failed.',
				ephemeral: true
			});
		}
		return;
	}

	// Tell user about successful creation and show the alt data off a bit.
	const usableByMention = usableByType === UsableByType.User ? userMention(usableById) : roleMention(usableById);
	const altEmbed = new MessageEmbed().setAuthor(name, avatarUrl).addField('Can be used by', usableByMention);
	await interaction.reply({
		content: 'New alternate character was successfully created.',
		embeds: [altEmbed],
		ephemeral: true
	});
}

async function handleEditAlt(interaction) {
	const guildId = interaction.guildId;

	// Try to find the existing alt by the provided name.
	const name = interaction.options.getString('name', true);
	let alt = null;
	try {
		alt = getAlt(guildId, name);
	} catch (e) {
		console.error('Error while trying to fetch alt from db:', e);
		await interaction.reply({
			content:
				'An error occurred while trying to find the alternate character in the database. Please try again later.',
			ephemeral: true
		});
		return;
	}
	if (!alt) {
		await interaction.reply({
			content: `There is no alternate character by the name "${name}".`,
			ephemeral: true
		});
		return;
	}

	// Get an updated object to store in the database.
	const patchedAlt = await getPatchedAlt(alt, interaction);
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
		await interaction.reply({
			content: 'Updating the alternate character failed.',
			ephemeral: true
		});
		return;
	}

	const usableByMention =
		patchedAlt.usableByType === UsableByType.User
			? userMention(patchedAlt.usableById)
			: roleMention(patchedAlt.usableById);
	const altEmbed = new MessageEmbed()
		.setAuthor(patchedAlt.name, patchedAlt.avatarUrl)
		.addField('Can be used by', usableByMention);
	await interaction.reply({
		content: 'Alternate character was successfully updated.',
		embeds: [altEmbed],
		ephemeral: true
	});
}

async function handleDeleteAlt(interaction) {
	const guildId = interaction.guildId;
	const name = interaction.options.getString('name', true);

	try {
		const deleted = deleteAlt(guildId, name);
		if (deleted) {
			console.debug(`An alt with the name "${name}" was deleted in guild ${guildId}.`);
			await interaction.reply({
				content: `The alternate character with the name "${name}" was successfully deleted.`,
				ephemeral: true
			});
		} else {
			await interaction.reply({
				content: `There is no alternate character by the name "${name}".`,
				ephemeral: true
			});
		}
	} catch (e) {
		console.error(e);
		await interaction.reply({
			content: `Could not delete alternate character by the name "${name}".`,
			ephemeral: true
		});
	}
}

async function handleShowAlts(interaction) {
	const guildId = interaction.guildId;
	const name = interaction.options.getString('name');

	if (name) {
		let alt = null;
		try {
			alt = getAlt(guildId, name);
		} catch (e) {
			console.error('Error while trying to fetch alt from db:', e);
			await interaction.reply({
				content:
					'An error occurred while trying to find the alternate character in the database. Please try again later.',
				ephemeral: true
			});
			return;
		}
		if (!alt) {
			await interaction.reply({
				content: `There is no alternate character by the name "${name}".`,
				ephemeral: true
			});
			return;
		}

		const usableByMention =
			alt.usableByType === UsableByType.User ? userMention(alt.usableById) : roleMention(alt.usableById);
		const altEmbed = new MessageEmbed().setAuthor(alt.name, alt.avatarUrl).addField('Can be used by', usableByMention);
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
			await interaction.reply({
				content:
					'An error occurred while trying to find the alternate characters of this server in the database. Please try again later.',
				ephemeral: true
			});
			return;
		}
		// Once we can get user locales from interactions, we can use those instead.
		const collator = new Intl.Collator('en');
		const altNameList = alts
			.map(alt => alt.name)
			// The database already does some sorting for us but it's not very good at proper i18n sorting.
			.sort(collator.compare)
			.join('\n');
		await interaction.reply({
			content:
				`The following alternate characters currently exist. Use ${inlineCode(
					'/config-alt show <name>'
				)} to find out details about a particular alternate character.\n\n` + altNameList,
			ephemeral: true
		});
	}
}

async function getPatchedAlt(alt, interaction) {
	const patchedAlt = { ...alt };

	let newName = interaction.options.getString('new-name');
	if (newName) {
		newName = newName.trim();
		const errorMessage = validateWebhookName(newName);
		if (errorMessage) {
			await interaction.reply({
				content: errorMessage,
				ephemeral: true
			});
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
