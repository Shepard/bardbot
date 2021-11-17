import Database from 'better-sqlite3';
import fsPromises from 'fs/promises';

const db = new Database('db/bard.db');

export default db;

export async function initDatabase() {
	const initTablesSql = await fsPromises.readFile('./storage/tables.sql', 'utf8');
	db.exec(initTablesSql);
	// TODO Figure out updating mechanism.
}

export function closeDatabase() {
	db.close();
}