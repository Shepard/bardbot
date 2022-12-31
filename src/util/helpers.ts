export function chunk<T>(items: T[], chunkSize: number): T[][] {
	if (chunkSize === 0) {
		return [];
	}
	const chunked: T[][] = [];
	for (let i = 0; i < items.length; i += chunkSize) {
		chunked.push(items.slice(i, i + chunkSize));
	}
	return chunked;
}

export function addMonths(inputDate: Date, months: number) {
	const date = new Date(inputDate);
	date.setDate(1);
	date.setMonth(date.getMonth() + months);
	date.setDate(Math.min(inputDate.getDate(), getDaysInMonth(date.getFullYear(), date.getMonth() + 1)));
	return date;
}

function getDaysInMonth(year: number, month: number) {
	return new Date(year, month, 0).getDate();
}

export function getCurrentDateString() {
	return new Date().toISOString().substring(0, 10);
}

export function codePointLength(s: string) {
	let i = 0;
	/* eslint-disable no-unused-vars */
	// This produces code points rather than chars.
	for (let c of s) {
		i++;
	}
	return i;
}

export function trimText(text: string, maxCodePoints: number) {
	if (maxCodePoints < 1) {
		return '';
	}
	let result = '';
	let lastChar = '';
	let tooLong = false;
	let i = 0;
	// This produces code points rather than chars.
	for (let c of text) {
		if (i === maxCodePoints - 1) {
			lastChar = c;
		} else if (i === maxCodePoints) {
			// We're already at one character more in this string than we want so it is definitely too long and needs to be abbreviated.
			tooLong = true;
			break;
		} else {
			result += c;
		}

		i++;
	}
	if (tooLong) {
		return result + '…';
	}
	result += lastChar;
	return result;
}

/**
 * Breaks a string up into parts such that each part has as many characters as possible but not more than maxCodePointsPerPart characters.
 * Prefers to break strings at line-breaks, then other kinds of whitespace. Will break at any character if no whitespace was found.
 * @returns An array of strings which are the parts of the input text.
 */
export function splitTextAtWhitespace(text: string, maxCodePointsPerPart: number) {
	// TODO later: break at word boundary chars like in regexes (and include them).

	const result = [];
	let buffer = '';
	let bufferUpToWhitespace = '';
	let bufferAfterWhitespace = '';
	let counter = 0;
	let lastWhitespaceChar = '';
	let lineBreakSeen = false;
	// This produces code points rather than chars.
	for (let c of text) {
		if (counter === maxCodePointsPerPart) {
			if (bufferUpToWhitespace.length > 0) {
				result.push(bufferUpToWhitespace);
				buffer = bufferAfterWhitespace;
				// TODO later: counting again could be avoided if we keep track.
				counter = codePointLength(buffer);
			} else {
				result.push(buffer);
				buffer = '';
				counter = 0;
			}
			bufferUpToWhitespace = '';
			bufferAfterWhitespace = '';
			lastWhitespaceChar = '';
			lineBreakSeen = false;
		}

		if (counter === 0 && result.length > 0 && c.trim() === '') {
			// We ignore leading whitespace of later parts.
			// This is to handle cases like splitTextAtWhitespace('abc de', 3) and get ['abc', 'de'] instead of ['abc', ' de'].
			continue;
		}

		buffer += c;
		// Line-breaks get preference:
		// Later line-breaks override previous ones.
		// Other whitespace only gets considered as a potential break character if we haven't seen a line-break before.
		if (c === '\n' || (!lineBreakSeen && c.trim() === '')) {
			bufferUpToWhitespace += lastWhitespaceChar + bufferAfterWhitespace;
			bufferAfterWhitespace = '';
			lastWhitespaceChar = c;
			if (c === '\n') {
				lineBreakSeen = true;
			}
		} else {
			bufferAfterWhitespace += c;
		}

		counter++;
	}
	if (buffer.length > 0) {
		result.push(buffer);
	}
	return result;
}

export async function wait(ms: number): Promise<void> {
	return new Promise(function (resolve) {
		if (ms > 0) {
			setTimeout(resolve, ms);
		} else {
			resolve();
		}
	});
}

/**
 * Takes a string (that a user might've entered) containing a text to search for
 * and turns it into a pattern that can be used in a SQL LIKE clause.
 * The LIKE clause should look as follows: "LIKE :pattern ESCAPE '#'"
 * where ":pattern" is a parameter replaced with the output of this function.
 */
export function escapeSearchInputToLikePattern(searchInput: string) {
	const escapedSearchInput = searchInput.replaceAll('#', '##').replaceAll('%', '#%').replaceAll('_', '#_');
	return '%' + escapedSearchInput + '%';
}

export function differenceSet<I>(iterableA: Iterable<I>, iterableB: Iterable<I>) {
	const difference = new Set(iterableA);
	for (const elem of iterableB) {
		difference.delete(elem);
	}
	return difference;
}

// From https://stackoverflow.com/a/41548441
export function enumFromStringValue<T>(enm: { [s: string]: T }, value: string): T | undefined {
	return (Object.values(enm) as unknown as string[]).includes(value) ? (value as unknown as T) : undefined;
}
