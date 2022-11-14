import { potentiallyDeleteMessageMetadata } from './message-delete.js';
import logger from '../util/logger.js';

const messageDeleteBulkEvent = {
	name: 'messageDeleteBulk',
	execute(messages) {
		messages.each(message => {
			potentiallyDeleteMessageMetadata(message).catch(e => logger.error(e));
		});
	}
};

export default messageDeleteBulkEvent;
