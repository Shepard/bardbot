import db from './database.js';

export const MessageType = Object.freeze({
	Bookmark: 'Bookmark',
	Quote: 'Quote',
	Arrival: 'Arrival'
});

const getMessageMetadataStatement = db.prepare(
	'SELECT channel_id, guild_id, sent_timestamp, interacting_user_id, message_type FROM message_metadata WHERE message_id = ?'
);
const addMessageMetadataStatement = db.prepare(
	'INSERT INTO message_metadata(message_id, channel_id, guild_id, sent_timestamp, interacting_user_id, message_type) VALUES(?, ?, ?, ?, ?, ?)'
);
const deleteMessageMetadataStatement = db.prepare('DELETE FROM message_metadata WHERE message_id = ?');
const deleteOutdatedMessageMetadataStatement = db.prepare('DELETE FROM message_metadata WHERE sent_timestamp < ?');

/**
 * Tries to find metadata for a given message id in the database.
 * If no entry is present in the database or if an error occurred while querying the database,
 * this is handled and null is returned.
 */
export function getMessageMetadata(messageId) {
	try {
		const metadata = getMessageMetadataStatement.get(messageId);
		if (metadata) {
			return {
				messageId,
				channelId: metadata.channel_id,
				guildId: metadata.guild_id,
				sentTimestamp: metadata.sent_timestamp,
				interactingUserId: metadata.interacting_user_id,
				messageType: metadata.message_type
			};
		}
		return null;
	} catch (e) {
		console.error(e);
		return null;
	}
}

/**
 * Records metadata for a message. Handles errors and logs them, so the caller doesn't have to catch anything.
 */
export function addMessageMetadata(message, interactingUserId, messageType) {
	try {
		// The timestamp is saved as an integer of the number of milliseconds since 1970.
		addMessageMetadataStatement.run(
			message.id,
			message.channelId,
			message.guildId,
			message.createdTimestamp,
			interactingUserId,
			messageType
		);
	} catch (e) {
		console.error(`Error while trying to store metadata for message '${message.id}':`, e);
	}
}

/**
 * Delete metadata entry for a message, if any.
 *
 * @throws Caller has to handle potential database errors.
 */
export function deleteMessageMetadata(messageId) {
	deleteMessageMetadataStatement.run(messageId);
}

/**
 * Deletes metadata entries for messages that are more than 6 months old and returns the number of deleted entries.
 *
 * @throws Caller has to handle potential database errors.
 */
export function deleteOutdatedMessageMetadata() {
	const timestampHalfAYearAgo = addMonths(new Date(), -6).getTime();
	const info = deleteOutdatedMessageMetadataStatement.run(timestampHalfAYearAgo);
	return info.changes;
}

function getDaysInMonth(year, month) {
	return new Date(year, month, 0).getDate();
}

function addMonths(input, months) {
	const date = new Date(input);
	date.setDate(1);
	date.setMonth(date.getMonth() + months);
	date.setDate(Math.min(input.getDate(), getDaysInMonth(date.getFullYear(), date.getMonth() + 1)));
	return date;
}

// TODO Method for cleaning all metadata held for a user? Or do that via an external script? Or maybe trigger with inter-process communication?
