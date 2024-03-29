import { Statement } from 'better-sqlite3';
import { Logger } from 'pino';
import { Alt, BasicAlt, UsableByType } from './record-types.js';
import db, { registerDbInitialisedListener } from './database.js';
import { ensureGuildConfigurationExists } from './guild-config-dao.js';
import { escapeSearchInputToLikePattern } from '../util/helpers.js';

let addAltStatement: Statement = null;
let getAltStatement: Statement = null;
let getAltsStatement: Statement = null;
let findMatchingAltsStatement: Statement = null;
let countAltsStatement: Statement = null;
let editAltStatement: Statement = null;
let deleteAltStatement: Statement = null;

registerDbInitialisedListener(() => {
	addAltStatement = db.prepare(
		'INSERT INTO alt(guild_id, name, usable_by_id, usable_by_type, avatar_url) VALUES(:guildId, :name, :usableById, :usableByType, :avatarUrl)'
	);
	getAltStatement = db.prepare(
		'SELECT id, name, usable_by_id, usable_by_type, avatar_url FROM alt WHERE guild_id = :guildId AND name = :name'
	);
	// The ordering can only case-insensitively compare ASCII letters. See https://www.sqlite.org/datatype3.html#collation.
	// Therefore we also sort in JS later on (same for findMatchingAltsStatement).
	getAltsStatement = db.prepare(
		'SELECT id, name, usable_by_id, usable_by_type, avatar_url FROM alt WHERE guild_id = :guildId ORDER BY name'
	);
	// TODO I want ICU case-insensitive matching. See:
	//  - https://www.sqlite.org/lang_expr.html#the_like_glob_regexp_and_match_operators
	//  - https://github.com/JoshuaWise/better-sqlite3/issues/465
	//  - https://github.com/JoshuaWise/better-sqlite3/blob/master/docs/api.md#loadextensionpath-entrypoint---this
	//  - https://sqlite.org/loadext.html
	//  - https://www.sqlite.org/src/dir?ci=tip&name=ext/icu
	findMatchingAltsStatement = db.prepare(
		"SELECT name, usable_by_id, usable_by_type FROM alt WHERE guild_id = :guildId AND name LIKE :pattern ESCAPE '#' ORDER BY name"
	);
	countAltsStatement = db.prepare('SELECT count(id) FROM alt WHERE guild_id = :guildId').pluck();
	editAltStatement = db.prepare(
		'UPDATE alt SET name = :name, usable_by_id = :usableById, usable_by_type = :usableByType, avatar_url = :avatarUrl WHERE id = :id'
	);
	deleteAltStatement = db.prepare('DELETE FROM alt WHERE guild_id = :guildId AND name = :name');
});

/**
 * Adds an alternate character to the database.
 * @param guildId The id of the guild to which the alternate character should be added.
 * @param name The name that the alternate character will be displayed with.
 * @param usableById The id of a user or role that will be allowed to use this alternate character.
 * @param usableByType Indicate if usableById is a user or role,
 * using the values UsableByType.User and UsableByType.Role respectively.
 * @param avatarUrl A URL for the avatar that the alternate character will be displayed with.
 * @returns The id of the alt that was added.
 * @throws Caller has to handle potential database errors.
 */
export function addAlt(
	guildId: string,
	name: string,
	usableById: string,
	usableByType: UsableByType,
	avatarUrl: string
) {
	ensureGuildConfigurationExists(guildId);

	const info = addAltStatement.run({ guildId, name, usableById, usableByType, avatarUrl });
	return info.lastInsertRowid;
}

/**
 * Tries to find an alternate character in the database.
 * @param guildId The id of the guild the alternate character belongs to.
 * @param name The name of the alternate character, used to identify it (in combination with the guildId).
 * Needs to be an exact match for the name of an existing alt.
 * @returns An object containing the properties "id" (internal database id of the alt), "guildId", "name",
 * "usableById", "usableByType", "avatarUrl" - or null if no alt was found.
 * @throws Caller has to handle potential database errors.
 */
export function getAlt(guildId: string, name: string): Alt {
	const row = getAltStatement.get({ guildId, name });
	if (row) {
		return {
			id: row.id,
			guildId,
			name: row.name,
			usableById: row.usable_by_id,
			usableByType: row.usable_by_type,
			avatarUrl: row.avatar_url
		};
	}
	return null;
}

/**
 * Fetches all alternate characters belonging to a specific guild from the database.
 * @param guildId The id of the guild the alternate characters belong to.
 * @returns An array of objects containing the properties "id" (internal database id of the alt), "guildId", "name",
 * "usableById", "usableByType", "avatarUrl" - or an empty array if no alt was found.
 * @throws Caller has to handle potential database errors.
 */
export function getAlts(guildId: string): Alt[] {
	return getAltsStatement.all({ guildId }).map(row => ({
		id: row.id,
		guildId,
		name: row.name,
		usableById: row.usable_by_id,
		usableByType: row.usable_by_type,
		avatarUrl: row.avatar_url
	}));
}

/**
 * Tries to find alternate characters that match the given search string in their name.
 * @param guildId The id of the guild to search in.
 * @param searchInput The string to match against the names of the alternate characters.
 * The searchInput will be matched as a case-insensitive infix of the name.
 * @returns An array of objects with some basic information for each matching alternate characters.
 * The objects contain "name", "usableById" and "usableByType" values and are ordered by the name
 * (although the ordering is very basic and does not deal with characters beyond the basic Latin alphabet very well).
 * If no matching alternate characters could be found or if an error occurred during the database fetching,
 * this is handled and an empty array is returned.
 */
export function findMatchingAlts(guildId: string, searchInput: string, logger: Logger): BasicAlt[] {
	try {
		const pattern = escapeSearchInputToLikePattern(searchInput);
		return findMatchingAltsStatement
			.all({ guildId, pattern })
			.map(row => ({ name: row.name, usableById: row.usable_by_id, usableByType: row.usable_by_type }));
	} catch (e) {
		logger.error(e);
		return [];
	}
}

/**
 * Counts the number of alternate characters that exist in a guild.
 * @param guildId The id of the guild to search.
 * @returns The number of alts that exist. 0 if there are none or if an error occurred during the database fetching.
 */
export function getNumberOfAlts(guildId: string, logger: Logger): number {
	try {
		const result = countAltsStatement.get({ guildId });
		return result ?? 0;
	} catch (e) {
		logger.error(e);
		return 0;
	}
}

/**
 * Changes properties of an existing alternate character in the database.
 * @param patchedAlt An object containing all the properties an alternate character can have in the database.
 * The values of those properties will be used to override the existing alt.
 * In particular: "id" will be used to identify the alt to override.
 * The other properties are name, usableById, usableByType and avatarUrl.
 * The guildId property, while it can be provided, will be ignored.
 * @throws Caller has to handle potential database errors.
 */
export function editAlt(patchedAlt: Alt) {
	editAltStatement.run(patchedAlt);
}

/**
 * Deletes an existing alternate character in the database.
 * @param guildId The id of the guild the alternate character belongs to.
 * @param name The name of the alternate character, used to identify it (in combination with the guildId).
 * Needs to be an exact match for the name of an existing alt.
 * @returns The number of deleted rows. Should be 1 if an alt was found and deleted, 0 otherwise.
 * @throws Caller has to handle potential database errors.
 */
export function deleteAlt(guildId: string, name: string) {
	const info = deleteAltStatement.run({ guildId, name });
	return info.changes;
}
