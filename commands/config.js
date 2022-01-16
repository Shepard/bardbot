import { Constants, Permissions, MessageEmbed, Webhook } from 'discord.js';
import { channelMention, italic } from '@discordjs/builders';
import {
	getGuildConfig,
	setConfigurationValues,
	clearConfigurationValues,
	setBookmarksChannel,
	setQuotesChannel,
	addRolePlayChannel,
	removeRolePlayChannel,
	removeAllRolePlayChannels,
	getWebhookIdForRolePlayChannel,
	getWebhookIdsForRolePlayChannels
} from '../storage/guild-config-dao.js';
import { updateCommandsForSingleGuild } from '../command-handling/update-commands.js';
import { createWebhook } from '../util/webhook-util.js';

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
								name: 'role-play channels',
								value: 'role-play-channels'
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
	async execute(interaction, t) {
		const subcommandGroup = interaction.options.getSubcommandGroup(false);
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'show') {
			await showConfiguration(interaction, t);
		} else if (subcommand === 'set') {
			await setConfiguration(interaction, t);
		} else if (subcommand === 'reset') {
			await resetConfiguration(interaction, t);
		} else if (subcommand === 'role-play-channel') {
			if (subcommandGroup === 'add') {
				await handleAddRolePlayChannelInteraction(interaction, t);
			} else if (subcommandGroup === 'remove') {
				await handleRemoveRolePlayChannelInteraction(interaction, t);
			} else {
				await t.privateReplyShared(interaction, 'unknown-command');
			}
		} else {
			await t.privateReplyShared(interaction, 'unknown-command');
		}
	}
};

async function showConfiguration(interaction, t) {
	const guildConfig = getGuildConfig(interaction.guildId);
	const bookmarksChannelValue = guildConfig.bookmarksChannel
		? channelMention(guildConfig.bookmarksChannel)
		: italic(t.user('show-value-none'));
	const quotesChannelValue = guildConfig.quotesChannel
		? channelMention(guildConfig.quotesChannel)
		: italic(t.user('show-value-none'));

	const rolePlayChannelsList = getChannelsList(guildConfig.rolePlayChannels);

	const configurationValuesEmbed = new MessageEmbed()
		.setTitle(t.user('show-title'))
		.setDescription(t.user('show-description'))
		.addField(t.user('show-field-bookmarks-channel'), bookmarksChannelValue)
		.addField(t.user('show-field-quotes-channel'), quotesChannelValue);
	if (rolePlayChannelsList.length <= FIELD_VALUE_CHARACTER_LIMIT) {
		configurationValuesEmbed.addField(t.user('show-field-role-play-channels'), rolePlayChannelsList);
	}
	await interaction.reply({
		embeds: [configurationValuesEmbed],
		ephemeral: true
	});
	// If the RP channel list doesn't fit in a single field value,
	// send it in the description of a follow-up embed instead.
	if (rolePlayChannelsList.length > FIELD_VALUE_CHARACTER_LIMIT) {
		const rolePlayChannelsListEmbed = new MessageEmbed()
			.setTitle(t.user('show-field-role-play-channels'))
			.setDescription(rolePlayChannelsList);
		await interaction.followUp({
			embeds: [rolePlayChannelsListEmbed],
			ephemeral: true
		});
	}
}

async function setConfiguration(interaction, t) {
	const bookmarksChannel = interaction.options.getChannel('bookmarks-channel');
	const quotesChannel = interaction.options.getChannel('quotes-channel');

	if (!bookmarksChannel && !quotesChannel) {
		await t.privateReply(interaction, 'reply.missing-option');
		return;
	}

	try {
		setConfigurationValues(interaction.guildId, {
			bookmarksChannelId: bookmarksChannel ? bookmarksChannel.id : null,
			quotesChannelId: quotesChannel ? quotesChannel.id : null
		});
	} catch (e) {
		console.error(`Database error while trying to set configuration values for guild ${interaction.guildId}:`, e);
		await t.privateReply(interaction, 'reply.set-failure');
		return;
	}

	await t.privateReply(interaction, 'reply.set-success');

	await updateCommandsAfterConfigChange(interaction, t);
}

async function resetConfiguration(interaction, t) {
	const option = interaction.options.getString('option');
	let webhookIds = null;
	try {
		if (option === 'all') {
			webhookIds = getWebhookIdsForRolePlayChannels(interaction.guildId);
			clearConfigurationValues(interaction.guildId);
		} else if (option === 'role-play-channels') {
			webhookIds = getWebhookIdsForRolePlayChannels(interaction.guildId);
			removeAllRolePlayChannels(interaction.guildId);
		} else if (option === 'bookmarks-channel') {
			setBookmarksChannel(interaction.guildId, null);
		} else if (option === 'quotes-channel') {
			setQuotesChannel(interaction.guildId, null);
		}
	} catch (e) {
		console.error(`Database error while trying to clear options for guild ${interaction.guildId}:`, e);
		await t.privateReply(interaction, 'reply.reset-failure');
		return;
	}

	// If all RP channels were reset, we need to remove all webhooks for them in Discord as well.
	if (webhookIds) {
		await Promise.allSettled(
			webhookIds.map(webhookId => {
				return new Webhook(interaction.client, { id: webhookId }).delete().catch(e => {
					console.error(
						`Error while trying to delete ${webhookId} in Discord in guild ${interaction.guildId} after clearing configuration values:`,
						e
					);
				});
			})
		);
	}

	await t.privateReply(interaction, 'reply.reset-success');

	await updateCommandsAfterConfigChange(interaction, t);
}

async function handleAddRolePlayChannelInteraction(interaction, t) {
	const channel = getChannel(interaction);
	if (!channel) {
		await t.privateReply(interaction, 'reply.wrong-channel-type');
		return;
	}

	try {
		const webhook = await createWebhook(channel, interaction.client);
		if (webhook) {
			addRolePlayChannel(interaction.guildId, channel.id, webhook.id);
		} else {
			await t.privateReply(interaction, 'reply.add-failure');
			return;
		}
	} catch (e) {
		console.error(`Database error while trying to add role-play channel for guild ${interaction.guildId}:`, e);
		await t.privateReply(interaction, 'reply.add-failure');
		return;
	}

	await t.privateReply(interaction, 'reply.add-success');

	await updateCommandsAfterConfigChange(interaction, t);
}

async function handleRemoveRolePlayChannelInteraction(interaction, t) {
	const channel = getChannel(interaction);
	if (!channel) {
		await t.privateReply(interaction, 'reply.wrong-channel-type');
		return;
	}

	let webhookId = null;
	try {
		webhookId = getWebhookIdForRolePlayChannel(interaction.guildId, channel.id);
		removeRolePlayChannel(interaction.guildId, channel.id);
	} catch (e) {
		console.error(`Database error while trying to remove role-play channel for guild ${interaction.guildId}:`, e);
		await t.privateReply(interaction, 'reply.remove-failure');
		return;
	}

	if (webhookId) {
		try {
			await new Webhook(interaction.client, { id: webhookId }).delete();
		} catch (e) {
			console.error(
				`Could not delete webhook ${webhookId} in Discord after removing role-play channel ${channel.id} in guild ${interaction.guildId}:`,
				e
			);
		}
	}

	await t.privateReply(interaction, 'reply.remove-success');

	await updateCommandsAfterConfigChange(interaction, t);
}

function getChannel(interaction) {
	// Either get the channel from a provided option 'channel' or fall back to the channel the interaction was sent in.
	const channel = interaction.options.getChannel('channel');
	if (channel) {
		// Other channel types should be prevented by the command configuration anyway but just to be safe...
		if (channel.type === Constants.ChannelTypes[Constants.ChannelTypes.GUILD_TEXT]) {
			return channel;
		}
	}
	// Make sure the user is using this command in a guild text channel.
	// The check is a bit awkward because channel.type gives us the string version of the enum value
	// which we have to fetch from the constants using the number version.
	if (interaction.channel.type === Constants.ChannelTypes[Constants.ChannelTypes.GUILD_TEXT]) {
		return interaction.channel;
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

export async function updateCommandsAfterConfigChange(interaction, t) {
	try {
		await updateCommandsForSingleGuild(interaction.client, interaction.guild);
	} catch (e) {
		console.error(
			`Error while trying to update commands for guild ${interaction.guildId} after changing configuration:`,
			e
		);
		await interaction.followUp({
			content: t.userShared('commands-update-failure1') + '\n' + t.userShared('commands-update-failure2'),
			ephemeral: true
		});
	}
}

export default configCommand;
