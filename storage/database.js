import Database from 'better-sqlite3';
import fsPromises from 'fs/promises';
import fs from 'fs';
import { EventEmitter } from 'events';

const dbDir = './db';
if (!fs.existsSync(dbDir)) {
	fs.mkdirSync(dbDir);
}

const db = new Database('db/bard.db');

export default db;

let initialised = false;
const dbEventEmitter = new EventEmitter();

export function registerDbInitialisedListener(listener) {
	if (initialised) {
		listener();
	} else {
		dbEventEmitter.on('initialised', listener);
	}
}

export async function initDatabase() {
	const initTablesSql = await fsPromises.readFile('./storage/tables.sql', 'utf8');
	db.exec(initTablesSql);
	// TODO Figure out updating mechanism.
	initialised = true;
	dbEventEmitter.emit('initialised');
}

export function closeDatabase() {
	db.close();
}
