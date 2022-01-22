import { deleteMessageMetadata } from '../storage/message-metadata-dao.js';
import { getWebhookForMessageIfCreatedByBot } from '../util/webhook-util.js';
import logger from '../util/logger.js';

const messageDeleteEvent = {
	name: 'messageDelete',
	execute(message) {
		// When a message gets deleted in Discord we need to check if it's one of ours
		// and potentially delete metadata we were holding for it.
		// This handles both the case that this bot triggered a delete of said message
		// and the case that an administrator deleted a message of our bot.
		potentiallyDeleteMessageMetadata(message).catch(e => logger.error(e));
	}
};

export async function potentiallyDeleteMessageMetadata(message) {
	if (await isCreatedByBot(message)) {
		try {
			// Since this will get called for the interaction reply we send and delete for /alt,
			// we don't want to do anything then because it can get a bit spammy.
			if (!message.interaction || message.interaction.commandName !== 'alt') {
				logger.info('Deleting metadata for message %s after message was deleted.', message.id);
				deleteMessageMetadata(message.id);
			}
		} catch (e) {
			logger.error(e, 'Error while trying to delete metadata for message after message was deleted.');
		}
	}
}

async function isCreatedByBot(message) {
	const authoredByBot = message.author?.id === message.client.user.id;
	if (authoredByBot) {
		return true;
	}
	const webhook = await getWebhookForMessageIfCreatedByBot(message, logger);
	return !!webhook;
}

export default messageDeleteEvent;
