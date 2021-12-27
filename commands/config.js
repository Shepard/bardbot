import { Constants, Permissions, MessageEmbed } from 'discord.js';
import { channelMention, inlineCode, italic } from '@discordjs/builders';
import {
	getGuildConfig,
	setConfigurationValues,
	clearConfigurationValues,
	setBookmarksChannel,
	setQuotesChannel,
	addRolePlayChannel,
	removeRolePlayChannel
} from '../storage/guild-config-dao.js';
import { updateCommandsForSingleGuild } from '../command-handling/update-commands.js';

// Limit for characters in a field value of an embed.
// See https://discord.com/developers/docs/resources/channel#embed-limits
const FIELD_VALUE_CHARACTER_LIMIT = 1024;

const configCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'config',
		description: 'Configure the bot for your server.',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'show',
				description: 'List the current values of all options.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND
			},
			{
				name: 'set',
				description: 'Set the values of one or more options.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'bookmarks-channel',
						description: 'The channel to set for posting bookmarks in',
						type: Constants.ApplicationCommandOptionTypes.CHANNEL,
						channel_types: [Constants.ChannelTypes.GUILD_TEXT]
					},
					{
						name: 'quotes-channel',
						description: 'The channel to set for posting quotes in',
						type: Constants.ApplicationCommandOptionTypes.CHANNEL,
						channel_types: [Constants.ChannelTypes.GUILD_TEXT]
					}
				]
			},
			{
				name: 'reset',
				description: 'Clear the value of one or all options or reset to the default.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'option',
						description: 'The option to clear',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						required: true,
						choices: [
							{
								name: 'all',
								value: 'all'
							},
							{
								name: 'bookmarks channel',
								value: 'bookmarks-channel'
							},
							{
								name: 'quotes channel',
								value: 'quotes-channel'
							}
						]
					}
				]
			},
			{
				name: 'add',
				description: 'Add a value to the options.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND_GROUP,
				options: [
					{
						name: 'role-play-channel',
						description: 'Add a channel to the list of role-play channels for this server.',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
						options: [
							{
								name: 'channel',
								description: 'The channel to add as a role-play channel. Leave empty to use the current channel.',
								type: Constants.ApplicationCommandOptionTypes.CHANNEL,
								channel_types: [Constants.ChannelTypes.GUILD_TEXT],
								required: false
							}
						]
					}
				]
			},
			{
				name: 'remove',
				description: 'Remove a value from the options.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND_GROUP,
				options: [
					{
						name: 'role-play-channel',
						description: 'Remove a channel from the list of role-play channels for this server.',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
						options: [
							{
								name: 'channel',
								description: 'The role-play channel to remove. Leave empty to use the current channel.',
								type: Constants.ApplicationCommandOptionTypes.CHANNEL,
								channel_types: [Constants.ChannelTypes.GUILD_TEXT],
								required: false
							}
						]
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
		const subcommandGroup = interaction.options.getSubcommandGroup(false);
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'show') {
			await showConfiguration(interaction);
		} else if (subcommand === 'set') {
			await setConfiguration(interaction);
		} else if (subcommand === 'reset') {
			await resetConfiguration(interaction);
		} else if (subcommand === 'role-play-channel') {
			if (subcommandGroup === 'add') {
				await handleAddRolePlayChannelInteraction(interaction);
			} else if (subcommandGroup === 'remove') {
				await handleRemoveRolePlayChannelInteraction(interaction);
			} else {
				await interaction.reply({
					content: 'Unknown command',
					ephemeral: true
				});
			}
		} else {
			await interaction.reply({
				content: 'Unknown command',
				ephemeral: true
			});
		}
	}
};

async function showConfiguration(interaction) {
	const guildConfig = getGuildConfig(interaction.guildId);
	const bookmarksChannelValue = guildConfig.bookmarksChannel
		? channelMention(guildConfig.bookmarksChannel)
		: italic('none');
	const quotesChannelValue = guildConfig.quotesChannel ? channelMention(guildConfig.quotesChannel) : italic('none');

	const rolePlayChannelsList = getChannelsList(guildConfig.rolePlayChannels);

	const configurationValuesEmbed = new MessageEmbed()
		.setTitle('Configuration')
		.setDescription(
			`This is the current configuration of the bot in this server. To change any options, use the ${inlineCode(
				'/config set'
			)} command.`
		)
		.addField('Bookmarks channel', bookmarksChannelValue)
		.addField('Quotes channel', quotesChannelValue);
	if (rolePlayChannelsList.length <= FIELD_VALUE_CHARACTER_LIMIT) {
		configurationValuesEmbed.addField('Role-play channels', rolePlayChannelsList);
	}
	await interaction.reply({
		embeds: [configurationValuesEmbed],
		ephemeral: true
	});
	// If the RP channel list doesn't fit in a single field value,
	// send it in the description of a follow-up embed instead.
	if (rolePlayChannelsList.length > FIELD_VALUE_CHARACTER_LIMIT) {
		const rolePlayChannelsListEmbed = new MessageEmbed()
			.setTitle('Role-play channels')
			.setDescription(rolePlayChannelsList);
		await interaction.followUp({
			embeds: [rolePlayChannelsListEmbed],
			ephemeral: true
		});
	}
}

async function setConfiguration(interaction) {
	const bookmarksChannel = interaction.options.getChannel('bookmarks-channel');
	const quotesChannel = interaction.options.getChannel('quotes-channel');

	if (!bookmarksChannel && !quotesChannel) {
		await interaction.reply({
			content: 'Please specify an option to set.',
			ephemeral: true
		});
		return;
	}

	try {
		setConfigurationValues(interaction.guildId, {
			bookmarksChannelId: bookmarksChannel ? bookmarksChannel.id : null,
			quotesChannelId: quotesChannel ? quotesChannel.id : null
		});
	} catch (e) {
		console.error(`Database error while trying to set configuration values for guild ${interaction.guildId}:`, e);
		await interaction.reply({
			content: 'Changing configuration failed.',
			ephemeral: true
		});
		return;
	}

	await interaction.reply({
		content: 'Successfully changed configuration.',
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction);
}

async function resetConfiguration(interaction) {
	const option = interaction.options.getString('option');
	try {
		if (option === 'all') {
			clearConfigurationValues(interaction.guildId);
		} else if (option === 'bookmarks-channel') {
			setBookmarksChannel(interaction.guildId, null);
		} else if (option === 'quotes-channel') {
			setQuotesChannel(interaction.guildId, null);
		}
	} catch (e) {
		console.error(`Database error while trying to clear options for guild ${interaction.guildId}:`, e);
		await interaction.reply({
			content: 'Resetting options failed.',
			ephemeral: true
		});
		return;
	}

	await interaction.reply({
		content: 'Successfully reset options.',
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction);
}

async function handleAddRolePlayChannelInteraction(interaction) {
	const channelId = getChannelId(interaction);
	if (!channelId) {
		await interaction.reply({
			content: 'This will only work with text channels in a server.',
			ephemeral: true
		});
		return;
	}
	try {
		addRolePlayChannel(interaction.guildId, channelId);
	} catch (e) {
		console.error(`Database error while trying to add role-play channel for guild ${interaction.guildId}:`, e);
		await interaction.reply({
			content: 'Adding the role-play channel failed.',
			ephemeral: true
		});
		return;
	}

	await interaction.reply({
		content: 'Successfully added role-play channel.',
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction);
}

async function handleRemoveRolePlayChannelInteraction(interaction) {
	const channelId = getChannelId(interaction);
	if (!channelId) {
		await interaction.reply({
			content: 'This will only work with text channels in a server.',
			ephemeral: true
		});
		return;
	}
	try {
		removeRolePlayChannel(interaction.guildId, channelId);
	} catch (e) {
		console.error(`Database error while trying to remove role-play channel for guild ${interaction.guildId}:`, e);
		await interaction.reply({
			content: 'Removing the role-play channel failed.',
			ephemeral: true
		});
		return;
	}

	await interaction.reply({
		content: 'Successfully removed role-play channel.',
		ephemeral: true
	});

	await updateCommandsAfterConfigChange(interaction);
}

function getChannelId(interaction) {
	// Either get the channel from a provided option 'channel' or fall back to the channel the interaction was sent in.
	const channel = interaction.options.getChannel('channel');
	if (channel) {
		// Other channel types should be prevented by the command configuration anyway but just to be safe...
		if (channel.type === Constants.ChannelTypes[Constants.ChannelTypes.GUILD_TEXT]) {
			return channel.id;
		}
	}
	// Make sure the user is using this command in a guild text channel.
	// The check is a bit awkward because channel.type gives us the string version of the enum value
	// which we have to fetch from the constants using the number version.
	if (interaction.channel.type === Constants.ChannelTypes[Constants.ChannelTypes.GUILD_TEXT]) {
		return interaction.channelId;
	}
	return null;
}

function getChannelsList(channelIds) {
	// It would be nice to be able to print the channel list in server order and with categories as headers.
	// Unfortunately channel positions from API are buggy so we can't do that for now.
	// const guildChannels = await interaction.guild.channels.fetch();
	// guildChannels.each(guildChannel => {
	// 	console.log(
	// 		`Position: ${guildChannel.position}, raw position: ${guildChannel.rawPosition}, type: ${guildChannel.type}, name: ${guildChannel.name}` +
	// 			(guildChannel.parent ? `, parent: ${guildChannel.parent.name}` : '')
	// 	);
	// });
	const channelsList = channelIds.map(channelId => channelMention(channelId)).join('\n');
	if (channelsList.length > 0) {
		return channelsList;
	}
	return '-';
}

async function updateCommandsAfterConfigChange(interaction) {
	try {
		await updateCommandsForSingleGuild(interaction.client, interaction.guild);
	} catch (e) {
		console.error(
			`Error while trying to update commands for guild ${interaction.guildId} after changing configuration:`,
			e
		);
		await interaction.followUp({
			content:
				'Configuration was changed but commands could not be updated on the server.\n' +
				`This could be a temporary problem. You can try updating them yourself later by using ${inlineCode(
					'/refresh-commands'
				)}.`,
			ephemeral: true
		});
	}
}

export default configCommand;
