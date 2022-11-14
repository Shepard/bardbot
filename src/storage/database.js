import Database from 'better-sqlite3';
import fsPromises from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import logger from '../util/logger.js';
import { getCurrentDateString } from '../util/helpers.js';

const UPGRADES_DIR = './upgrades';
const UPGRADE_FILE_PATTERN = /^V([1-9]\d*)__.*\.sql$/i;

const dbDir = './db';
export const FILES_DIR = dbDir + path.sep + 'files';
await fsPromises.mkdir(FILES_DIR, { recursive: true });

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
	const userVersion = db.pragma('user_version', { simple: true });
	const upgrades = await getUpgrades(userVersion);

	if (upgrades.length && userVersion) {
		// Make backup of db file before applying upgrades.
		await db.backup('db/bard_backup_v' + userVersion + '_' + getCurrentDateString() + '.db');
	}

	for (const upgrade of upgrades) {
		db.transaction(() => {
			db.exec(upgrade.upgradeSql);
			db.pragma('user_version = ' + upgrade.version);
			logger.info('Applied upgrade %s, increasing version to %d.', upgrade.fileName, upgrade.version);
		})();
	}

	initialised = true;
	dbEventEmitter.emit('initialised');
}

async function getUpgrades(startingFromVersion) {
	const upgradeFileNames = await fsPromises.readdir(UPGRADES_DIR);
	const upgrades = (
		await Promise.all(
			upgradeFileNames.map(fileName => {
				const matches = fileName.match(UPGRADE_FILE_PATTERN);
				if (matches) {
					const version = parseInt(matches[1]);
					if (!isNaN(version) && version > startingFromVersion) {
						return fsPromises
							.readFile(`${UPGRADES_DIR}/${fileName}`, 'utf8')
							.then(upgradeSql => ({ version, upgradeSql, fileName }));
					}
				}
				return Promise.resolve(null);
			})
		)
	).filter(x => x !== null);
	upgrades.sort((a, b) => a.version - b.version);
	return upgrades;
}

export async function backupDatabase() {
	const fileName = 'bard_backup_' + getCurrentDateString() + '.db';
	await db.backup('db/' + fileName);
	// TODO backup files along with db.
	//  files and db backup need to be put together in a folder or a zip file.
	//  need to ensure we capture the files in the same state as the db backup by using a lock/mutex.
	//  this method waits until it can get access to the lock.
	//  then it acquires it, runs the backup in a try block and releases the lock in a finally block.
	//  other users of the files directory (like story-dao) need to await access to the lock as well:
	//  deleting story files only happens with cleanup jobs.
	//  writing story files happens when adding a story or replacing its file. those would need to wait for the lock.
	//  need to ensure that future file writers consider the lock as well.
	return fileName;
}

export function closeDatabase() {
	db.close();
}
