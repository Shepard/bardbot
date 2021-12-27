import { deleteMessageMetadata } from '../storage/message-metadata-dao.js';

const messageDeleteEvent = {
	name: 'messageDelete',
	execute(message) {
		// When a message gets deleted in Discord we need to check if it's one of ours
		// and potentially delete metadata we were holding for it.
		// This handles both the case that this bot triggered a delete of said message
		// and the case that an administrator deleted a message of our bot.
		potentiallyDeleteMessageMetadata(message);
	}
};

export function potentiallyDeleteMessageMetadata(message) {
	if (message.author.id === message.client.user.id) {
		try {
			console.debug(`Deleting metadata for message ${message.id} after message was deleted.`);
			deleteMessageMetadata(message.id);
		} catch (e) {
			console.error('Error while trying to delete metadata for message after message was deleted:', e);
		}
	}
}

export default messageDeleteEvent;
