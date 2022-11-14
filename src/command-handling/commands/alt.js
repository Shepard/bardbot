import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import { addMessageMetadata, MessageType } from '../../storage/message-metadata-dao.js';
import { getWebhookIdForRolePlayChannel } from '../../storage/guild-config-dao.js';
import { findMatchingAlts, getAlt, getNumberOfAlts, UsableByType } from '../../storage/alt-dao.js';
import { AUTOCOMPLETE_CHOICE_LIMIT, MESSAGE_CONTENT_CHARACTER_LIMIT } from '../../util/discord-constants.js';
import { errorReply, warningReply } from '../../util/interaction-util.js';

const altCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'alt',
		type: ApplicationCommandType.ChatInput,
		options: [
			{
				name: 'name',
				type: ApplicationCommandOptionType.String,
				required: true,
				autocomplete: true
			},
			{
				name: 'message',
				type: ApplicationCommandOptionType.String,
				required: true,
				max_length: MESSAGE_CONTENT_CHARACTER_LIMIT
			}
		]
	},
	// Test function to check if the command should apply to a guild
	guard(client, guild, guildConfig, logger) {
		return guildConfig?.rolePlayChannels?.length && getNumberOfAlts(guild.id, logger) > 0;
	},
	// Handler for when the command is used
	async execute(interaction, { t, logger }) {
		const altName = interaction.options.getString('name');
		const messageText = interaction.options.getString('message');

		const webhook = await getWebhook(interaction, t, logger);
		if (!webhook) {
			// getWebhook already handled telling the user about it.
			return;
		}

		try {
			let alt = null;
			try {
				alt = getAlt(interaction.guildId, altName);
			} catch (e) {
				logger.error(e, 'Error while trying to fetch alt from db');
				await errorReply(interaction, t.userShared('alt-db-fetch-error'));
				return;
			}
			if (!alt) {
				await warningReply(interaction, t.userShared('no-alt-with-name', { altName }));
				return;
			}
			if (!isUsableByUser(alt, interaction, logger)) {
				await warningReply(interaction, t.user('reply.alt-not-usable', { altName }));
				return;
			}

			// Channels not viewable by the bot can cause problems so we don't allow alts to be used there.
			// The webhook can send the message but we don't get messageDelete events for it and /where currently excludes such channels as well.
			if (!interaction.channel.viewable) {
				await warningReply(interaction, t.user('reply.channel-not-viewable'));
				return;
			}

			// Send message using webhook for this RP channel and with the name and avatar for the alt picked by the user.
			const altMessage = await webhook.send({
				content: messageText,
				username: alt.name,
				avatarURL: alt.avatarUrl,
				// We could try to find out which roles the member is allowed to ping in a complicated way but it's easier to just restrict it to none.
				allowed_mentions: {
					parse: []
				}
			});

			try {
				// We need to reply to the interaction as well, otherwise it will be shown as pending and eventually failed.
				// Since we don't really want to show a reply every time an alt message was sent, we send it and immediately delete it again.
				await interaction.reply({
					content: t.guild('reply.alt-message-success')
					// Can't be ephemeral because then it can't be deleted.
				});
				await interaction.deleteReply();
			} catch (e) {
				logger.error(e, 'Error while trying to handle interaction reply after sending alt message');
			}

			// Record the alt message as sent by the user.
			addMessageMetadata(altMessage, interaction.user.id, MessageType.AltMessage, logger);
		} catch (e) {
			logger.error(e, 'Error while trying to send alt message');
			await errorReply(interaction, t.user('reply.alt-message-failure'));
		}
	},
	async autocomplete(interaction, { logger }) {
		const focusedOption = interaction.options.getFocused(true);
		if (focusedOption.name === 'name') {
			const matchingAlts = findMatchingAlts(interaction.guildId, focusedOption.value, logger);
			let result = matchingAlts
				.filter(alt => isUsableByUser(alt, interaction, logger))
				.map(alt => ({ name: alt.name, value: alt.name }));
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

async function getWebhook(interaction, t, logger) {
	let webhookId = null;
	try {
		webhookId = getWebhookIdForRolePlayChannel(interaction.guildId, interaction.channelId);
	} catch (e) {
		logger.error(
			e,
			'Loading webhook id from database for channel %s in guild %s failed.',
			interaction.channelId,
			interaction.guildId
		);
		await errorReply(interaction, t.user('reply.alt-message-failure'));
		return null;
	}
	if (webhookId) {
		try {
			return interaction.client.fetchWebhook(webhookId);
		} catch (e) {
			logger.error(e, 'Fetching webhook failed.');
			await errorReply(interaction, t.user('reply.alt-message-failure'));
		}
	} else {
		await warningReply(interaction, t.user('reply.not-role-play-channel'));
	}
	return null;
}

function isUsableByUser(alt, interaction, logger) {
	if (alt.usableByType === UsableByType.User) {
		return interaction.user.id === alt.usableById;
	} else if (alt.usableByType === UsableByType.Role) {
		return interaction.member.roles.cache.has(alt.usableById);
	} else {
		logger.error('Unsupported type %s used for alt "%s" in guild %s.', alt.usableByType, alt.name, interaction.guildId);
		return false;
	}
}

export default altCommand;
