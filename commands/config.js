import { Constants, Permissions, MessageEmbed, Webhook } from 'discord.js';
import { channelMention, italic } from '@discordjs/builders';
import {
	setConfigurationValues,
	clearConfigurationValues,
	setBookmarksChannel,
	setQuotesChannel,
	setLanguage,
	addRolePlayChannel,
	removeRolePlayChannel,
	removeAllRolePlayChannels,
	getWebhookIdForRolePlayChannel,
	getWebhookIdsForRolePlayChannels
} from '../storage/guild-config-dao.js';
import { updateCommandsForSingleGuild } from '../command-handling/update-commands.js';
import { createWebhook } from '../util/webhook-util.js';
import { SUPPORTED_LANGUAGES, translate } from '../util/i18n.js';
import { codePointLength } from '../util/helpers.js';
import { EMBED_FIELD_VALUE_CHARACTER_LIMIT } from '../util/discord-constants.js';
import { errorReply, warningReply } from '../util/interaction-util.js';

const configCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'config',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		defaultMemberPermissions: new Permissions([Permissions.FLAGS.MANAGE_GUILD]),
		options: [
			{
				name: 'show',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND
			},
			{
				name: 'set',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'bookmarks-channel',
						type: Constants.ApplicationCommandOptionTypes.CHANNEL,
						channel_types: [Constants.ChannelTypes.GUILD_TEXT]
					},
					{
						name: 'quotes-channel',
						type: Constants.ApplicationCommandOptionTypes.CHANNEL,
						channel_types: [Constants.ChannelTypes.GUILD_TEXT]
					},
					{
						name: 'language',
						type: Constants.ApplicationCommandOptionTypes.STRING,
						choices: getLanguageChoices()
					}
				]
			},
			{
				name: 'reset',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
				options: [
					{
						name: 'option',
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
							},
							{
								name: 'language',
								value: 'language'
							}
						]
					}
				]
			},
			{
				name: 'add',
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND_GROUP,
				options: [
					{
						name: 'role-play-channel',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
						options: [
							{
								name: 'channel',
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
				type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND_GROUP,
				options: [
					{
						name: 'role-play-channel',
						type: Constants.ApplicationCommandOptionTypes.SUB_COMMAND,
						options: [
							{
								name: 'channel',
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
	// Handler for when the command is used
	async execute(interaction, { t, guildConfig, logger }) {
		const subcommandGroup = interaction.options.getSubcommandGroup(false);
		const subcommand = interaction.options.getSubcommand(false);
		if (subcommand === 'show') {
			await showConfiguration(interaction, guildConfig, t);
		} else if (subcommand === 'set') {
			await setConfiguration(interaction, guildConfig, t, logger);
		} else if (subcommand === 'reset') {
			await resetConfiguration(interaction, t, logger);
		} else if (subcommand === 'role-play-channel') {
			if (subcommandGroup === 'add') {
				await handleAddRolePlayChannelInteraction(interaction, t, logger);
			} else if (subcommandGroup === 'remove') {
				await handleRemoveRolePlayChannelInteraction(interaction, t, logger);
			} else {
				await warningReply(interaction, t.userShared('unknown-command'));
			}
		} else {
			await warningReply(interaction, t.userShared('unknown-command'));
		}
	}
};

async function showConfiguration(interaction, guildConfig, t) {
	const bookmarksChannelValue = guildConfig.bookmarksChannel
		? channelMention(guildConfig.bookmarksChannel)
		: italic(t.user('show-value-none'));
	const quotesChannelValue = guildConfig.quotesChannel
		? channelMention(guildConfig.quotesChannel)
		: italic(t.user('show-value-none'));
	const languageValue = guildConfig.language
		? translate('languageName', { lng: guildConfig.language })
		: italic(t.user('show-value-none'));

	const rolePlayChannelsList = getChannelsList(guildConfig.rolePlayChannels);
	const rolePlayChannelsListFitsInField = codePointLength(rolePlayChannelsList) <= EMBED_FIELD_VALUE_CHARACTER_LIMIT;

	const configurationValuesEmbed = new MessageEmbed()
		.setTitle(t.user('show-title'))
		.setDescription(
			t.user('show-description', {
				command1: '/config set',
				command2: '/config add role-play-channel',
				guildId: interaction.guildId
			})
		)
		.addFields(
			{ name: t.user('show-field-bookmarks-channel'), value: bookmarksChannelValue },
			{ name: t.user('show-field-quotes-channel'), value: quotesChannelValue }
		);
	if (rolePlayChannelsListFitsInField) {
		configurationValuesEmbed.addFields({ name: t.user('show-field-role-play-channels'), value: rolePlayChannelsList });
	}
	configurationValuesEmbed.addFields({ name: t.user('show-field-language'), value: languageValue });
	await interaction.reply({
		embeds: [configurationValuesEmbed],
		ephemeral: true
	});
	// If the RP channel list doesn't fit in a single field value,
	// send it in the description of a follow-up embed instead.
	if (!rolePlayChannelsListFitsInField) {
		const rolePlayChannelsListEmbed = new MessageEmbed()
			.setTitle(t.user('show-field-role-play-channels'))
			.setDescription(rolePlayChannelsList);
		await interaction.followUp({
			embeds: [rolePlayChannelsListEmbed],
			ephemeral: true
		});
	}
}

async function setConfiguration(interaction, guildConfig, t, logger) {
	const bookmarksChannel = interaction.options.getChannel('bookmarks-channel');
	const quotesChannel = interaction.options.getChannel('quotes-channel');
	let language = interaction.options.getString('language');
	if (language && !SUPPORTED_LANGUAGES.includes(language)) {
		language = null;
	}

	if (!bookmarksChannel && !quotesChannel && !language) {
		await warningReply(interaction, t.user('reply.missing-option'));
		return;
	}

	try {
		// If no guildConfig existed in the database then the guildConfig object we have here only has an id property and all other properties would result in undefined.
		// We don't want to pass undefined into this method but only null values in this case, hence the "?? null".
		setConfigurationValues({
			id: guildConfig.id,
			bookmarksChannelId: bookmarksChannel ? bookmarksChannel.id : guildConfig.bookmarksChannel ?? null,
			quotesChannelId: quotesChannel ? quotesChannel.id : guildConfig.quotesChannel ?? null,
			language: language ?? guildConfig.language ?? null
		});
	} catch (e) {
		logger.error(e, 'Database error while trying to set configuration values for guild %s', interaction.guildId);
		await errorReply(interaction, t.user('reply.set-failure'));
		return;
	}

	await t.privateReply(interaction, 'reply.set-success');

	await updateCommandsAfterConfigChange(interaction, t, logger);
}

async function resetConfiguration(interaction, t, logger) {
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
		} else if (option === 'language') {
			setLanguage(interaction.guildId, null);
		}
	} catch (e) {
		logger.error(e, 'Database error while trying to clear options for guild %s', interaction.guildId);
		await errorReply(interaction, t.user('reply.reset-failure'));
		return;
	}

	// If all RP channels were reset, we need to remove all webhooks for them in Discord as well.
	if (webhookIds) {
		await Promise.allSettled(
			webhookIds.map(webhookId => {
				return new Webhook(interaction.client, { id: webhookId }).delete().catch(e => {
					logger.error(
						e,
						'Error while trying to delete %s in Discord in guild %s after clearing configuration values',
						webhookId,
						interaction.guildId
					);
				});
			})
		);
	}

	await t.privateReply(interaction, 'reply.reset-success');

	await updateCommandsAfterConfigChange(interaction, t, logger);
}

async function handleAddRolePlayChannelInteraction(interaction, t, logger) {
	const channel = getChannel(interaction);
	if (!channel) {
		await warningReply(interaction, t.user('reply.wrong-channel-type'));
		return;
	}

	try {
		const webhook = await createWebhook(channel, interaction.client, logger);
		if (webhook) {
			addRolePlayChannel(interaction.guildId, channel.id, webhook.id);
		} else {
			await errorReply(interaction, t.user('reply.add-failure'));
			return;
		}
	} catch (e) {
		logger.error(e, 'Database error while trying to add role-play channel for guild %s', interaction.guildId);
		await errorReply(interaction, t.user('reply.add-failure'));
		return;
	}

	await t.privateReply(interaction, 'reply.add-success');

	await updateCommandsAfterConfigChange(interaction, t, logger);
}

async function handleRemoveRolePlayChannelInteraction(interaction, t, logger) {
	const channel = getChannel(interaction);
	if (!channel) {
		await warningReply(interaction, t.user('reply.wrong-channel-type'));
		return;
	}

	let webhookId = null;
	try {
		webhookId = getWebhookIdForRolePlayChannel(interaction.guildId, channel.id);
		removeRolePlayChannel(interaction.guildId, channel.id);
	} catch (e) {
		logger.error(e, 'Database error while trying to remove role-play channel for guild %s', interaction.guildId);
		await errorReply(interaction, t.user('reply.remove-failure'));
		return;
	}

	if (webhookId) {
		try {
			await new Webhook(interaction.client, { id: webhookId }).delete();
		} catch (e) {
			logger.error(
				e,
				'Could not delete webhook %s in Discord after removing role-play channel %s in guild %s',
				webhookId,
				channel.id,
				interaction.guildId
			);
		}
	}

	await t.privateReply(interaction, 'reply.remove-success');

	await updateCommandsAfterConfigChange(interaction, t, logger);
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

function getLanguageChoices() {
	return (
		SUPPORTED_LANGUAGES
			// Each language is presented with the name of the language in that language.
			.map(languageTag => ({
				name: translate('languageName', { lng: languageTag }),
				value: languageTag
			}))
	);
}

export async function updateCommandsAfterConfigChange(interaction, t, logger) {
	try {
		await updateCommandsForSingleGuild(interaction.client, interaction.guild);
	} catch (e) {
		logger.error(
			e,
			'Error while trying to update commands for guild %s after changing configuration',
			interaction.guildId
		);
		await errorReply(
			interaction,
			t.userShared('commands-update-failure1') +
				'\n' +
				t.userShared('commands-update-failure2', { command: '/refresh-commands', guildId: interaction.guildId })
		);
	}
}

export default configCommand;
