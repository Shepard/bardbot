import { Client, ClientEvents } from 'discord.js';
import { ClientEventHandler } from './event-handler-types.js';
import channelDeleteEvent from './events/channel-delete.js';
import guildCreateEvent from './events/guild-create.js';
import guildDeleteEvent from './events/guild-delete.js';
import interactionCreateEvent from './events/interaction-create.js';
import messageDeleteBulkEvent from './events/message-delete-bulk.js';
import messageDeleteEvent from './events/message-delete.js';
import readyEvent from './events/ready.js';

const eventHandlers: ClientEventHandler<keyof ClientEvents>[] = [
	channelDeleteEvent,
	guildCreateEvent,
	guildDeleteEvent,
	interactionCreateEvent,
	messageDeleteBulkEvent,
	messageDeleteEvent,
	readyEvent
];

export default function registerEventHandlers(client: Client) {
	for (const eventHandler of eventHandlers) {
		if (eventHandler.once) {
			client.once(eventHandler.name, (...args) => eventHandler.execute(...args));
		} else {
			client.on(eventHandler.name, (...args) => eventHandler.execute(...args));
		}
	}
}
