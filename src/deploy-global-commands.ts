import process from 'process';
import { initI18n } from './util/i18n.js';
import { initDatabase, closeDatabase } from './storage/database.js';
import { loadCommands } from './command-handling/command-registry.js';
import logger from './util/logger.js';
import config from './util/config.js';
import { updateGlobalCommandsWithoutClient } from './command-handling/update-commands.js';

process.on('unhandledRejection', err => {
	logger.error(err, "There is an unhandled promise rejection. Forgot an 'await'?");
	process.exit(1);
});

try {
	await initI18n();
	await initDatabase();
	loadCommands();

	await updateGlobalCommandsWithoutClient(config.token, config.clientId);

	closeDatabase();
} catch (error) {
	logger.error(error);
}
