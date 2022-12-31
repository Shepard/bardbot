import {
	ApplicationCommandType,
	ApplicationCommandOptionType,
	ChannelType,
	PermissionFlagsBits,
	EmbedBuilder,
	channelMention,
	italic,
	ChatInputCommandInteraction,
	GuildBasedChannel,
	APIInteractionDataResolvedChannel,
	BaseGuildTextChannel,
	TextChannel,
	BaseInteraction
} from 'discord.js';
import { Logger } from 'pino';
import { CommandModule } from '../command-module-types.js';
import {
	GuildConfiguration,
	isFullGuildConfiguration,
	SUPPORTED_LANGUAGE_TAGS,
	isSupportedLanguage
} from '../../storage/record-types.js';
import { ContextTranslatorFunctions } from '../../util/interaction-types.js';
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
} from '../../storage/guild-config-dao.js';
import { updateCommandsForSingleGuild } from '../update-commands.js';
import { createWebhook } from '../../util/webhook-util.js';
import { translate } from '../../util/i18n.js';
import { codePointLength } from '../../util/helpers.js';
import { EMBED_FIELD_VALUE_CHARACTER_LIMIT } from '../../util/discord-constants.js';
import { errorReply, warningReply } from '../../util/interaction-util.js';

const configCommand: CommandModule<ChatInputCommandInteraction> = {
	getConfiguration: () => ({
		name: 'config',
		description: '',
		type: ApplicationCommandType.ChatInput,
		defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
		options: [
			{
				name: 'show',
				description: '',
				type: ApplicationCommandOptionType.Subcommand
			},
			{
				name: 'set',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'bookmarks-channel',
						description: '',
						type: ApplicationCommandOptionType.Channel,
						channel_types: [ChannelType.GuildText]
					},
					{
						name: 'quotes-channel',
						description: '',
						type: ApplicationCommandOptionType.Channel,
						channel_types: [ChannelType.GuildText]
					},
					{
						name: 'language',
						description: '',
						type: ApplicationCommandOptionType.String,
						choices: getLanguageChoices()
					}
				]
			},
			{
				name: 'reset',
				description: '',
				type: ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: 'option',
						description: '',
						type: ApplicationCommandOptionType.String,
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
				description: '',
				type: ApplicationCommandOptionType.SubcommandGroup,
				options: [
					{
						name: 'role-play-channel',
						description: '',
						type: ApplicationCommandOptionType.Subcommand,
						options: [
							{
								name: 'channel',
								description: '',
								type: ApplicationCommandOptionType.Channel,
								channel_types: [ChannelType.GuildText],
								required: false
							}
						]
					}
				]
			},
			{
				name: 'remove',
				description: '',
				type: ApplicationCommandOptionType.SubcommandGroup,
				options: [
					{
						name: 'role-play-channel',
						description: '',
						type: ApplicationCommandOptionType.Subcommand,
						options: [
							{
								name: 'channel',
								description: '',
								type: ApplicationCommandOptionType.Channel,
								channel_types: [ChannelType.GuildText],
								required: false
							}
						]
					}
				]
			}
		]
	}),
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

async function showConfiguration(
	interaction: ChatInputCommandInteraction,
	guildConfig: GuildConfiguration,
	t: ContextTranslatorFunctions
) {
	if (!isFullGuildConfiguration(guildConfig)) {
		await t.privateReplyShared(interaction, 'interaction.error');
		return;
	}

	const bookmarksChannelValue = guildConfig.bookmarksChannelId
		? channelMention(guildConfig.bookmarksChannelId)
		: italic(t.user('show-value-none'));
	const quotesChannelValue = guildConfig.quotesChannelId
		? channelMention(guildConfig.quotesChannelId)
		: italic(t.user('show-value-none'));
	const languageValue = guildConfig.language
		? translate('languageName', { lng: guildConfig.language })
		: italic(t.user('show-value-none'));

	const rolePlayChannelsList = getChannelsList(guildConfig.rolePlayChannelIds);
	const rolePlayChannelsListFitsInField = codePointLength(rolePlayChannelsList) <= EMBED_FIELD_VALUE_CHARACTER_LIMIT;

	const configurationValuesEmbed = new EmbedBuilder()
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
		const rolePlayChannelsListEmbed = new EmbedBuilder()
			.setTitle(t.user('show-field-role-play-channels'))
			.setDescription(rolePlayChannelsList);
		await interaction.followUp({
			embeds: [rolePlayChannelsListEmbed],
			ephemeral: true
		});
	}
}

async function setConfiguration(
	interaction: ChatInputCommandInteraction,
	guildConfig: GuildConfiguration,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	if (!isFullGuildConfiguration(guildConfig)) {
		await t.privateReplyShared(interaction, 'interaction.error');
		return;
	}

	const bookmarksChannel = interaction.options.getChannel('bookmarks-channel');
	const quotesChannel = interaction.options.getChannel('quotes-channel');
	const languageTag = interaction.options.getString('language');
	const language = languageTag && isSupportedLanguage(languageTag) ? languageTag : null;

	if (!bookmarksChannel && !quotesChannel && !language) {
		await warningReply(interaction, t.user('reply.missing-option'));
		return;
	}

	try {
		// If no guildConfig existed in the database then the guildConfig object we have here only has an id property and all other properties would result in undefined.
		// We don't want to pass undefined into this method but only null values in this case, hence the "?? null".
		setConfigurationValues({
			id: guildConfig.id,
			bookmarksChannelId: bookmarksChannel ? bookmarksChannel.id : guildConfig.bookmarksChannelId ?? null,
			quotesChannelId: quotesChannel ? quotesChannel.id : guildConfig.quotesChannelId ?? null,
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

async function resetConfiguration(
	interaction: ChatInputCommandInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	const option = interaction.options.getString('option');
	let webhookIds: string[] = null;
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
	if (webhookIds?.length) {
		const existingWebhooks = (await interaction.guild.fetchWebhooks()).filter(
			webhook => webhook.owner.id === interaction.client.user.id
		);
		await Promise.allSettled(
			webhookIds
				.filter(webhookId => existingWebhooks.has(webhookId))
				.map(webhookId => {
					const webhook = existingWebhooks.get(webhookId);
					return webhook.delete().catch(e => {
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

async function handleAddRolePlayChannelInteraction(
	interaction: ChatInputCommandInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
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

async function handleRemoveRolePlayChannelInteraction(
	interaction: ChatInputCommandInteraction,
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	const channel = getChannel(interaction);
	if (!channel) {
		await warningReply(interaction, t.user('reply.wrong-channel-type'));
		return;
	}

	let webhookId: string = null;
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
			const webhook = await interaction.client.fetchWebhook(webhookId);
			await webhook.delete();
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

function getChannel(interaction: ChatInputCommandInteraction): TextChannel | null {
	// Either get the channel from a provided option 'channel' or fall back to the channel the interaction was sent in.
	const channel = interaction.options.getChannel('channel');
	if (channel) {
		// Other channel types should be prevented by the command configuration anyway but just to be safe...
		if (channel.type === ChannelType.GuildText && isGuildBasedChannel(channel)) {
			return channel;
		}
	}
	// Make sure the user is using this command in a guild text channel.
	// The check is a bit awkward because channel.type gives us the string version of the enum value
	// which we have to fetch from the constants using the number version.
	if (interaction.channel.type === ChannelType.GuildText) {
		return interaction.channel;
	}
	return null;
}

function isGuildBasedChannel(
	channel: APIInteractionDataResolvedChannel | GuildBasedChannel
): channel is GuildBasedChannel {
	return (channel as BaseGuildTextChannel).send !== undefined;
}

function getChannelsList(channelIds: string[]) {
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
		SUPPORTED_LANGUAGE_TAGS
			// Each language is presented with the name of the language in that language.
			.map(languageTag => ({
				name: translate('languageName', { lng: languageTag }),
				value: languageTag
			}))
	);
}

export async function updateCommandsAfterConfigChange(
	interaction: BaseInteraction,
	// TODO typings: This is unused.
	t: ContextTranslatorFunctions,
	logger: Logger
) {
	try {
		await updateCommandsForSingleGuild(interaction.client, interaction.guild);
	} catch (e) {
		logger.error(
			e,
			'Error while trying to update commands for guild %s after changing configuration',
			interaction.guildId
		);
	}
}

export default configCommand;
