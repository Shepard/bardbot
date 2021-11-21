import { Constants, Permissions, MessageEmbed } from 'discord.js';
import { channelMention, inlineCode, italic } from '@discordjs/builders';
import { getGuildConfig, setConfigurationValues, clearConfigurationValues, setBookmarksChannel, setQuotesChannel } from '../storage/guild-config-dao.js';
import { updateCommandsForSingleGuild } from '../command-handling/update-commands.js';

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
						type: Constants.ApplicationCommandOptionTypes.CHANNEL
					},
					{
						name: 'quotes-channel',
						description: 'The channel to set for posting quotes in',
						type: Constants.ApplicationCommandOptionTypes.CHANNEL
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
			}
		]
	},
	// Command is only usable by users in roles that have the Administrator flag set.
	// Until Discord implements the new command permission system, this means that the server owner
	// can't use the command without explicitly having an admin role.
	permissions: [Permissions.FLAGS.ADMINISTRATOR],
	// Handler for when the command is used
	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'show') {
			await showConfiguration(interaction);
		} else if (subcommand === 'set') {
			await setConfiguration(interaction);
		} else if (subcommand === 'reset') {
			await resetConfiguration(interaction);
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
	const bookmarksChannelValue = guildConfig.bookmarksChannel ? channelMention(guildConfig.bookmarksChannel) : italic('none');
	const quotesChannelValue = guildConfig.quotesChannel ? channelMention(guildConfig.quotesChannel) : italic('none');
	const configurationValuesEmbed = new MessageEmbed()
		.setTitle('Configuration')
		.setDescription(`This is the current configuration of the bot in this server. To change any options, use the ${inlineCode('/config set')} command.`)
		.addField('Bookmarks channel', bookmarksChannelValue)
		.addField('Quotes channel', quotesChannelValue);
	await interaction.reply({
		embeds: [configurationValuesEmbed],
		ephemeral: true
	});
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

	try {
		await updateCommandsForSingleGuild(interaction.client, interaction.guild);
	} catch (e) {
		console.error(`Error while trying to update commands for guild ${interaction.guildId} after changing configuration:`, e);
		await interaction.followUp({
			content: 'Configuration was changed but commands could not be updated on the server.\n' +
				`This could be a temporary problem. You can try updating them yourself later by using ${inlineCode('/refresh-commands')}.`,
			ephemeral: true
		});
	}
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

	try {
		await updateCommandsForSingleGuild(interaction.client, interaction.guild);
	} catch (e) {
		console.error(`Error while trying to update commands for guild ${interaction.guildId} after clearing options:`, e);
		await interaction.followUp({
			content: 'Options were reset but commands could not be updated on the server.\n' +
				`This could be a temporary problem. You can try updating them yourself later by using ${inlineCode('/refresh-commands')}.`,
			ephemeral: true
		});
	}
}

export default configCommand;