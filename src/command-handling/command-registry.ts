import { Collection } from 'discord.js';
import { CommandModule } from './command-module-types.js';
import { addCommandTranslations } from './command-translations.js';

import altCommand from './commands/alt.js';
import blameContextCommand from './commands/blame-context.js';
import bookmarkCommand from './commands/bookmark.js';
import bookmarkContextCommand from './commands/boomark-context.js';
import cointossCommand from './commands/coin.js';
import configCommand from './commands/config.js';
import deleteContextCommand from './commands/delete-context.js';
import editContextCommand from './commands/edit-context.js';
import gotoCommand from './commands/goto.js';
import manageAltsCommand from './commands/manage-alts.js';
import manageStoriesCommand from './commands/manage-stories.js';
import namesCommand from './commands/names.js';
import narrateCommand from './commands/narrate.js';
import quoteContextCommand from './commands/quote-context.js';
import rollCommand from './commands/roll.js';
import storyCommand from './commands/story.js';
import whereCommand from './commands/where.js';

const commandModules: CommandModule[] = [
	altCommand,
	blameContextCommand,
	bookmarkCommand,
	bookmarkContextCommand,
	cointossCommand,
	configCommand,
	deleteContextCommand,
	editContextCommand,
	gotoCommand,
	manageAltsCommand,
	manageStoriesCommand,
	namesCommand,
	narrateCommand,
	quoteContextCommand,
	rollCommand,
	storyCommand,
	whereCommand
];

export const commands = new Collection<string, CommandModule>();

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
