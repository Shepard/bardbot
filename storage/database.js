import Database from 'better-sqlite3';
import fsPromises from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import logger from '../util/logger.js';

const UPGRADES_DIR = './storage/upgrades';
const UPGRADE_FILE_PATTERN = /^V([1-9]\d*)__.*\.sql$/i;

const dbDir = './db';
if (!fs.existsSync(dbDir)) {
	fs.mkdirSync(dbDir);
}
export const FILES_DIR = dbDir + path.sep + 'files';
if (!fs.existsSync(FILES_DIR)) {
	fs.mkdirSync(FILES_DIR);
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
	const userVersion = db.pragma('user_version', { simple: true });
	const upgrades = await getUpgrades(userVersion);

	if (upgrades.length) {
		// Make backup of db file before applying upgrades.
		const dateString = new Date().toISOString().substring(0, 10);
		await fsPromises.copyFile('./db/bard.db', './db/bard_backup_v' + userVersion + '_' + dateString + '.db');
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

export function closeDatabase() {
	db.close();
}
