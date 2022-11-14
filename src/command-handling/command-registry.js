import { Collection } from 'discord.js';
import { addCommandTranslations } from './command-translations.js';

import altCommand from './commands/alt.js';
import blameContextCommand from './commands/blame-context.js';
import bookmarkCommand from './commands/bookmark.js';
import bookmarkContextCommand from './commands/boomark-context.js';
import cointossCommand from './commands/coin.js';
import configAltCommand from './commands/config-alt.js';
import configStoryCommand from './commands/config-story.js';
import configCommand from './commands/config.js';
import deleteContextCommand from './commands/delete-context.js';
import editContextCommand from './commands/edit-context.js';
import gotoCommand from './commands/goto.js';
import namesCommand from './commands/names.js';
import narrateCommand from './commands/narrate.js';
import quoteContextCommand from './commands/quote-context.js';
import rollCommand from './commands/roll.js';
import storyCommand from './commands/story.js';
import whereCommand from './commands/where.js';

const commandModules = [
	altCommand,
	blameContextCommand,
	bookmarkCommand,
	bookmarkContextCommand,
	cointossCommand,
	configAltCommand,
	configStoryCommand,
	configCommand,
	deleteContextCommand,
	editContextCommand,
	gotoCommand,
	namesCommand,
	narrateCommand,
	quoteContextCommand,
	rollCommand,
	storyCommand,
	whereCommand
];

export const commands = new Collection();

export function loadCommands() {
	for (const commandModule of commandModules) {
		const command = { ...commandModule };
		if (commandModule.getConfiguration) {
			command.configuration = commandModule.getConfiguration();
		}
		addCommandTranslations(command);
		commands.set(command.configuration.name, command);
	}
}
