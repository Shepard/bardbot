import { Collection, Snowflake, Message } from 'discord.js';
import { ClientEventHandler } from '../event-handler-types.js';
import { potentiallyDeleteMessageMetadata } from './message-delete.js';
import logger from '../../util/logger.js';

const messageDeleteBulkEvent: ClientEventHandler<'messageDeleteBulk'> = {
	name: 'messageDeleteBulk',
	execute(messages: Collection<Snowflake, Message>) {
		messages.each(message => {
			potentiallyDeleteMessageMetadata(message).catch(e => logger.error(e));
		});
	}
};

export default messageDeleteBulkEvent;
