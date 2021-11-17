import { Constants, Permissions } from 'discord.js';
import { channelMention, inlineCode } from '@discordjs/builders';
import { getGuildConfig, setBookmarksChannel, setQuotesChannel } from '../storage/guild-config-dao.js';
import { updateCommandsForSingleGuild } from '../command-handling/update-commands.js';

const configCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'config',
		description: 'Configure the bot for your server.',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'bookmarks-channel',
				description: 'Configure the channel to post bookmarks to.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND_GROUP,
				options: [
					{
						name: 'set',
						description: 'Set the channel to post bookmarks to.',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
						options: [
							{
								name: 'channel',
								description: 'The bookmarks channel. If empty, the current channel is used.',
								type: Constants.ApplicationCommandOptionTypes.CHANNEL
							}
						]
					},
					{
						name: 'show',
						description: 'Show which channel is currently set for posting bookmarks to, if any.',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND
					},
					{
						name: 'clear',
						description: 'Clear the bookmarks channel currently set. This will disable bookmarking.',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND
					}
				]
			},
			{
				name: 'quotes-channel',
				description: 'Configure the channel to post quotes to.',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND_GROUP,
				options: [
					{
						name: 'set',
						description: 'Set the channel to post quotes to.',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
						options: [
							{
								name: 'channel',
								description: 'The quotes channel. If empty, the current channel is used.',
								type: Constants.ApplicationCommandOptionTypes.CHANNEL
							}
						]
					},
					{
						name: 'show',
						description: 'Show which channel is currently set for posting quotes to, if any.',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND
					},
					{
						name: 'clear',
						description: 'Clear the quotes channel currently set. This will disable quoting.',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND
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
		const subcommandGroup = interaction.options.getSubcommandGroup();
		const subcommand = interaction.options.getSubcommand();
		if (subcommandGroup === 'bookmarks-channel' || subcommandGroup === 'quotes-channel') {
			await configureChannel(interaction, subcommandGroup, subcommand);
		} else {
			await interaction.reply({
				content: 'Unknown command',
				ephemeral: true
			});
		}
	}
};

async function configureChannel(interaction, subcommandGroup, subcommand) {
	const isBookmarks = subcommandGroup === 'bookmarks-channel';
	if (subcommand === 'set') {
		await setChannel(interaction, isBookmarks);
	} else if (subcommand === 'show') {
		await showChannel(interaction, isBookmarks);
	} else if (subcommand === 'clear') {
		await clearChannel(interaction, isBookmarks);
	} else {
		await interaction.reply({
			content: 'Unknown command',
			ephemeral: true
		});
	}
}

async function setChannel(interaction, isBookmarks) {
	const channelSettingName = isBookmarks ? 'bookmarks' : 'quotes';
	const channelId = getChannelId(interaction);
	try {
		if (isBookmarks) {
			setBookmarksChannel(interaction.guildId, channelId);
		} else {
			setQuotesChannel(interaction.guildId, channelId);
		}
	} catch (e) {
		console.error(`Database error while trying to set ${channelSettingName} channel for guild ${interaction.guildId} to ${channelId}:`, e);
		await interaction.reply({
			content: isBookmarks ? 'Setting bookmarks channel failed.' : 'Setting quotes channel failed.',
			ephemeral: true
		});
		return;
	}

	await interaction.reply({
		content: isBookmarks ?
				`Successfully set bookmarks channel to ${channelMention(channelId)}.` :
				`Successfully set quotes channel to ${channelMention(channelId)}.`,
		ephemeral: true
	});

	try {
		await updateCommandsForSingleGuild(interaction.client, interaction.guild);
	} catch (e) {
		console.error(`Error while trying to update commands for guild ${interaction.guildId} after setting ${channelSettingName} channel to ${channelId}:`, e);
		await interaction.followUp({
			content: (isBookmarks ?
				`Bookmarks channel was set to ${channelMention(channelId)} but commands could not be updated on the server.\n` :
				`Quotes channel was set to ${channelMention(channelId)} but commands could not be updated on the server.\n`) +
				`This could be a temporary problem. You can try updating them yourself later by using ${inlineCode('/refresh-commands')}.`,
			ephemeral: true
		});
	}
}

async function showChannel(interaction, isBookmarks) {
	const guildConfig = getGuildConfig(interaction.guildId);
	const channelId = isBookmarks ? guildConfig.bookmarksChannel : guildConfig.quotesChannel;
	if (channelId) {
		await interaction.reply({
			content: isBookmarks ?
				`The bookmarks channel is ${channelMention(channelId)}.` :
				`The quotes channel is ${channelMention(channelId)}.`,
			ephemeral: true
		});
	} else {
		await interaction.reply({
			content: isBookmarks ? 'No bookmarks channel is currently set.' : 'No quotes channel is currently set.',
			ephemeral: true
		});
	}
}

async function clearChannel(interaction, isBookmarks) {
	const channelSettingName = isBookmarks ? 'bookmarks' : 'quotes';
	try {
		if (isBookmarks) {
			setBookmarksChannel(interaction.guildId, null);
		} else {
			setQuotesChannel(interaction.guildId, null);
		}
	} catch (e) {
		console.error(`Database error while trying to clear ${channelSettingName} channel for guild ${interaction.guildId}:`, e);
		await interaction.reply({
			content: isBookmarks ? 'Clearing bookmarks channel failed.' : 'Clearing quotes channel failed.',
			ephemeral: true
		});
		return;
	}

	await interaction.reply({
		content: isBookmarks ? 'Successfully cleared bookmarks channel.' : 'Successfully cleared quotes channel.',
		ephemeral: true
	});

	try {
		await updateCommandsForSingleGuild(interaction.client, interaction.guild);
	} catch (e) {
		console.error(`Error while trying to update commands for guild ${interaction.guildId} after clearing ${channelSettingName} channel:`, e);
		await interaction.followUp({
			content: (isBookmarks ?
				'Bookmarks channel was cleared but commands could not be updated on the server.\n' :
				'Quotes channel was cleared but commands could not be updated on the server.\n') +
				`This could be a temporary problem. You can try updating them yourself later by using ${inlineCode('/refresh-commands')}.`,
			ephemeral: true
		});
	}
}

function getChannelId(interaction) {
	// Either get the channel from a provided option 'channel' or fall back to the channel the interaction was sent in.
	const channel = interaction.options.getChannel('channel');
	if (channel) {
		return channel.id;
	}
	return interaction.channelId;
}

export default configCommand;