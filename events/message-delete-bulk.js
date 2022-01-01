import { potentiallyDeleteMessageMetadata } from './message-delete.js';

const messageDeleteBulkEvent = {
	name: 'messageDeleteBulk',
	execute(messages) {
		messages.each(message => {
			potentiallyDeleteMessageMetadata(message).catch(e => console.error(e));
		});
	}
};

export default messageDeleteBulkEvent;
