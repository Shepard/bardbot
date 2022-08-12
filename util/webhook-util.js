import { codePointLength } from '../util/helpers.js';
import {
	getRolePlayChannelsData,
	setWebhookIdForRolePlayChannel,
	removeRolePlayChannel
} from '../storage/guild-config-dao.js';
import logger from './logger.js';
import { WEBHOOK_NAME_CHARACTER_LIMIT } from './discord-constants.js';
import { DiscordAPIError } from 'discord.js';

export async function createWebhook(channel, client, logger) {
	try {
		return await channel.createWebhook(client.user.username);
	} catch (e) {
		logger.error(e, 'Error while trying to create webhook for channel %s', channel.id);
		return null;
	}
}

export async function getWebhookForMessageIfCreatedByBot(message, logger) {
	// When the webhookId is the applicationId then this is actually an interaction reply and not a webhook we can fetch.
	if (message.webhookId && message.webhookId !== message.applicationId) {
		try {
			const webhook = await message.fetchWebhook();
			if (webhook?.owner.id === message.client.user.id) {
				return webhook;
			}
		} catch (e) {
			logger.error(e);
		}
	}
	return null;
}

/**
 * Makes sure the name follows Discord's rules for webhooks.
 * @see {@link https://discord.com/developers/docs/resources/user#usernames-and-nicknames|Rules for names in general}
 * @see {@link https://discord.com/developers/docs/resources/webhook#create-webhook|Additional restrictions and different name length for webhooks}
 * @param {string} name The name to validate
 * @returns {string} A translation key for a human-readable error message if the name failed validation,
 * 	providing the specific reason why it failed. Or null if the name is valid.
 */
export function validateWebhookName(name) {
	let errorMessageKey = null;
	// Based on some simple testing, Discord seems to be counting Unicode code points,
	// not UTF-16 characters like JavaScript would do with "name.length".
	const nameLength = codePointLength(name);
	if (nameLength < 1 || nameLength > WEBHOOK_NAME_CHARACTER_LIMIT) {
		errorMessageKey = 'webhook-validation-error.name-length';
	}
	// Testing revealed that, contrary to the documentation and unlike the other forbidden words,
	// 'clyde' is actually checked as a case-insensitive substring on Discord's side.
	if (name.toLowerCase().includes('clyde')) {
		errorMessageKey = 'webhook-validation-error.clyde';
	}
	// Testing also revealed that these reserved strings, which are listed as not being allowed in usernames,
	// are not actually disallowed in webhook names.
	// Leaving them here for now anyway in case Discord change their mind about it.
	// Reported as a bug here: https://github.com/discord/discord-api-docs/issues/4293
	/*if (name === 'discordtag' || name === 'everyone' || name === 'here') {
		errorMessage = 'This name is reserved by Discord. Please pick another one.';
	}*/
	/*if (name.includes('@') || name.includes('#') || name.includes('```')) {
		errorMessage = "Name may not contain '@', '#' or '```'.";
	}*/
	return errorMessageKey;
}

/**
 * Ensures the webhooks of the bot in a guild match up with the webhook ids we have stored for the role-play channels of that guild.
 * If they don't, missing webhooks will be created (and the corresponding database records updated) and superfluous ones deleted.
 * @param {*} client The bot's client.
 * @param {*} guildId The id of the guild to check the webhooks of.
 */
export async function ensureWebhookCorrectness(client, guildId) {
	try {
		logger.info('Ensuring webhook correctness for guild %s.', guildId);

		const guild = await client.guilds.fetch({ guild: guildId, withCounts: false });
		const existingWebhooks = (await guild.fetchWebhooks()).filter(webhook => webhook.owner.id === client.user.id);
		const rpChannelsData = getRolePlayChannelsData(guildId);
		const usedWebhookIds = new Set();
		let createdCounter = 0;
		let deletedCounter = 0;

		// Make sure all RP channels have a working webhook set.
		const counterResults = await Promise.all(
			rpChannelsData.map(data => {
				return ensureRolePlayChannelHasCorrectWebhook(
					data.rolePlayChannelId,
					data.webhookId,
					existingWebhooks,
					usedWebhookIds,
					guild,
					client
				);
			})
		);
		for (let i = 0; i < counterResults.length; i++) {
			createdCounter += counterResults[i];
		}

		// After this step all RP channels should have the necessary webhooks and have the correct ids stored in the db.
		// Now we just need to delete superfluous webhooks.
		await Promise.all(
			existingWebhooks.map(webhook => {
				if (!usedWebhookIds.has(webhook.id)) {
					deletedCounter++;
					return webhook
						.delete()
						.catch(e =>
							logger.error(e, 'Could not delete superfluous webhook %s in Discord in guild %s', webhook.id, guildId)
						);
				}
				return Promise.resolve();
			})
		);

		logger.info(
			'Webhook correctness for guild %s ensured. %d webhook(s) created, %d webhook(s) deleted.',
			guildId,
			createdCounter,
			deletedCounter
		);
	} catch (e) {
		logger.error(e, 'Error while trying to ensure webhook correctness for guild %s', guildId);
		// TODO If the error was that the guild was not found, remove the configuration we have stored for the guild.
		//  If we just have no access, we might want to assume that our bot was just removed from the guild
		//  and we don't want to clean up just yet in case it gets readded later on.
		//  In that case, proceed as per our plans for guild cleanup in handleGuildDelete event.
	}
}

async function ensureRolePlayChannelHasCorrectWebhook(
	rpChannelId,
	currentlyConfiguredWebhookId,
	existingWebhooks,
	usedWebhookIds,
	guild,
	client
) {
	let createdCounter = 0;
	if (!existingWebhooks.has(currentlyConfiguredWebhookId)) {
		// See if there's any other existing webhook for this channel that we can change the database entry to. (How would that even happen?)
		let webhookForChannel = existingWebhooks.find(webhook => webhook.channelId === rpChannelId);
		if (!webhookForChannel) {
			// Apparently not, so we need to create one.
			try {
				const channel = await guild.channels.fetch(rpChannelId);
				webhookForChannel = await createWebhook(channel, client, logger);
				createdCounter++;
			} catch (e) {
				if (e instanceof DiscordAPIError && (e.message === 'Unknown Channel' || e.httpStatus === 404)) {
					// The server doesn't know this channel anymore so we can clean it up from the database.
					removeNonExistingRolePlayChannel(guild.id, rpChannelId);
				} else {
					logger.error(
						e,
						'Error while trying fetch channel %s for guild %s for creating a new webhook for it',
						rpChannelId,
						guild.id
					);
				}
			}
		} else {
			usedWebhookIds.add(webhookForChannel.id);
		}
		if (webhookForChannel) {
			try {
				setWebhookIdForRolePlayChannel(guild.id, rpChannelId, webhookForChannel.id);
			} catch (e) {
				logger.error(
					e,
					'Error while trying update webhook id to %s for guild %s and channel %s',
					webhookForChannel.id,
					guild.id,
					rpChannelId
				);
			}
		}
	} else {
		usedWebhookIds.add(currentlyConfiguredWebhookId);
		// We could theoretically check if it matches the channel but it seems super unlikely that it wouldn't.
	}
	return createdCounter;
}

function removeNonExistingRolePlayChannel(guildId, rpChannelId) {
	try {
		removeRolePlayChannel(guildId, rpChannelId);
		logger.info(
			'Detected non-existing role-play channel %s in guild %s while trying to ensure webhook correctness. Removed channel from database.',
			rpChannelId,
			guildId
		);
	} catch (e) {
		logger.error(e, 'Database error while trying to remove role-play channel for guild %s', guildId);
	}
}
