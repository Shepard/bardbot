// TODO write tests

/**
 * For parsing character definitions from global tags.
 * If the name needs spaces it can be wrapped in double quotes.
 * URL and colour value are optional. The "#" of the colour value is optional because it needs to be escaped in Ink which is awkward.
 * Examples:
 * CHARACTER:Doctor
 * charactEr: "Darth Vader" 000
 * Character:  Robespierre https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Robespierre_Ducreux.jpeg/181px-Robespierre_Ducreux.jpeg
 * character: "Elizabeth II" https://upload.wikimedia.org/wikipedia/commons/6/66/Queen_Elizabeth_II_on_3_June_2019.jpg #9cc6c5
 */
const CHARACTER_TAG_REGEXP =
	/^character:\s*(?:([^\s]+)|(?:"([^"]+)"))(?:\s+(?<url>http[^\s]+))?(?:\s+(?<colour>#?(?:[0-9a-fA-F]{3}){1,2}))?$/i;

const TITLE_TAG_REGEXP = /^title:(.+)$/i;

const AUTHOR_TAG_REGEXP = /^author:(.+)$/i;

const TEASER_TAG_REGEXP = /^teaser:(.+)$/i;

/**
 * Parses definitions of characters of the story from the global tags of the story.
 * @returns A map mapping the name of the character to an object with more information, like a icon URL or a colour to use for that character.
 */
export function parseCharacters(inkStory) {
	const characters = new Map();

	if (inkStory.globalTags) {
		for (let tag of inkStory.globalTags) {
			const match = tag.match(CHARACTER_TAG_REGEXP);
			if (match) {
				const name = match[1] ? match[1].trim() : match[2].trim();
				const character = { name };
				if (match.groups.url) {
					character.iconUrl = match.groups.url;
				}
				if (match.groups.colour) {
					character.colour = (match.groups.colour.startsWith('#') ? '' : '#') + match.groups.colour;
				}
				characters.set(name, character);
			}
		}
	}

	return characters;
}

export function parseMetadata(inkStory) {
	const metadata = {
		title: '',
		author: '',
		teaser: ''
	};

	if (inkStory.globalTags) {
		for (let tag of inkStory.globalTags) {
			const titleMatch = tag.match(TITLE_TAG_REGEXP);
			if (titleMatch) {
				metadata.title = titleMatch[1].trim();
			} else {
				const authorMatch = tag.match(AUTHOR_TAG_REGEXP);
				if (authorMatch) {
					metadata.author = authorMatch[1].trim();
				} else {
					const teaserMatch = tag.match(TEASER_TAG_REGEXP);
					if (teaserMatch) {
						metadata.teaser = teaserMatch[1].trim();
					}
				}
			}
		}
	}

	return metadata;
}
