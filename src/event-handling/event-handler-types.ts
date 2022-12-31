import { ClientEvents, Awaitable } from 'discord.js';

export interface ClientEventHandler<K extends keyof ClientEvents> {
	name: K;
	once?: boolean;
	execute: (...args: ClientEvents[K]) => Awaitable<void>;
}
