import { Statement } from 'better-sqlite3';
import db, { registerDbInitialisedListener } from './database.js';
import logger from '../util/logger.js';

let addGlobalCommandIdStatement: Statement | null = null;
let addGuildCommandIdStatement: Statement | null = null;
let deleteGlobalCommandIdsStatement: Statement | null = null;
let deleteGuildCommandIdsStatement: Statement | null = null;
let getGlobalCommandsStatement: Statement | null = null;
let getGuildCommandsStatement: Statement | null = null;

registerDbInitialisedListener(() => {
	addGlobalCommandIdStatement = db.prepare(
		'INSERT INTO global_command_id(command_name, command_id)' + ' VALUES(:commandName, :commandId)'
	);
	addGuildCommandIdStatement = db.prepare(
		'INSERT INTO guild_command_id(guild_id, command_name, command_id)' + ' VALUES(:guildId, :commandName, :commandId)'
	);
	deleteGlobalCommandIdsStatement = db.prepare('DELETE FROM global_command_id');
	deleteGuildCommandIdsStatement = db.prepare('DELETE FROM guild_command_id WHERE guild_id = :guildId');
	getGlobalCommandsStatement = db.prepare('SELECT command_name, command_id FROM global_command_id');
	getGuildCommandsStatement = db.prepare('SELECT guild_id, command_name, command_id FROM guild_command_id');
});

export function persistGlobalCommandIds(commandIds: Map<string, string>) {
	try {
		deleteGlobalCommandIdsStatement.run();
		commandIds.forEach((commandId, commandName) => {
			addGlobalCommandIdStatement.run({ commandName, commandId });
		});
	} catch (error) {
		logger.error(error);
	}
}

export function persistGuildCommandIds(guildId: string, commandIds: Map<string, string>) {
	try {
		deleteGuildCommandIdsStatement.run({ guildId });
		commandIds.forEach((commandId, commandName) => {
			addGuildCommandIdStatement.run({ guildId, commandName, commandId });
		});
	} catch (error) {
		logger.error(error);
	}
}

export function loadGlobalCommandIds(): Map<string, string> {
	try {
		const result = new Map<string, string>();
		getGlobalCommandsStatement.all().forEach(row => {
			result.set(row.command_name, row.command_id);
		});
		return result;
	} catch (error) {
		logger.error(error);
		return new Map<string, string>();
	}
}

export function loadGuildCommandIds(): Map<string, Map<string, string>> {
	try {
		const result = new Map<string, Map<string, string>>();
		getGuildCommandsStatement.all().forEach(row => {
			let guildCommands = result.get(row.guild_id);
			if (!guildCommands) {
				guildCommands = new Map<string, string>();
				result.set(row.guild_id, guildCommands);
			}
			guildCommands.set(row.command_name, row.command_id);
		});
		return result;
	} catch (error) {
		logger.error(error);
		return new Map<string, Map<string, string>>();
	}
}
