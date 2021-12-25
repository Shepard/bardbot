import { potentiallyDeleteMessageMetadata } from './message-delete.js';

const messageDeleteBulkEvent = {
	name: 'messageDeleteBulk',
	async execute(messages) {
		messages.each(message => {
			potentiallyDeleteMessageMetadata(message);
		});
	}
};

export default messageDeleteBulkEvent;
