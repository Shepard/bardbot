import { HexColorString } from 'discord.js';
import { Story } from '@shepard4711/inkjs/engine/Story.js';
import { Choice } from '@shepard4711/inkjs/engine/Choice.js';
import {
	StoryMetadata,
	StoryCharacter,
	ChoiceButtonStyle,
	StoryLine,
	CharacterImageSize,
	LineSpeech,
	ChoiceAction
} from './story-types.js';

/**
 * For parsing character definitions from global tags.
 * It starts with "character:". All following parts are separated from each other by commas.
 * The first two parts are required: character id and character name.
 * URL and colour value are optional. The "#" of the colour value is optional because it needs to be escaped in Ink which is awkward.
 * Examples:
 * CHARACTER:Doctor,Doctor
 * charactEr: vader, Darth Vader, 000000
 * Character:  Rob  ,  Robespierre, https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Robespierre_Ducreux.jpeg/181px-Robespierre_Ducreux.jpeg
 * character: lizzie, Elizabeth II, https://upload.wikimedia.org/wikipedia/commons/6/66/Queen_Elizabeth_II_on_3_June_2019.jpg, #9cc6c5
 */
const CHARACTER_TAG_REGEXP =
	/^character:\s*([^,]+)\s*,\s*([^,]+)(?:\s*,\s*(?<url>http[^\s,]+))?(?:\s*,\s*(?<colour>#?[0-9a-fA-F]{6}))?$/i;

/**
 * For parsing character definitions from global tags with the legacy syntax.
 * If the name needs spaces it can be wrapped in double quotes.
 * URL and colour value are optional. The "#" of the colour value is optional because it needs to be escaped in Ink which is awkward.
 * Examples:
 * CHARACTER:Doctor
 * charactEr: "Darth Vader" 000000
 * Character:  Robespierre https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Robespierre_Ducreux.jpeg/181px-Robespierre_Ducreux.jpeg
 * character: "Elizabeth II" https://upload.wikimedia.org/wikipedia/commons/6/66/Queen_Elizabeth_II_on_3_June_2019.jpg #9cc6c5
 */
const CHARACTER_TAG_REGEXP_LEGACY =
	/^character:\s*(?:([^\s]+)|(?:"([^"]+)"))(?:\s+(?<url>http[^\s]+))?(?:\s+(?<colour>#?[0-9a-fA-F]{6}))?$/i;

const TITLE_TAG_REGEXP = /^title:(.+)$/i;

const AUTHOR_TAG_REGEXP = /^author:(.+)$/i;

const TEASER_TAG_REGEXP = /^teaser:(.+)$/i;

const DEFAULT_BUTTON_STYLE_TAG_REGEXP = /^default-button-style:\s*(primary|secondary|success|danger)$/i;

const BUTTON_STYLE_TAG_REGEXP = /^button-style:\s*(primary|secondary|success|danger)$/i;

// Character ranges allowed and excluded in ink identifiers:
// https://github.com/y-lohse/inkjs/blob/master/src/compiler/Parser/InkParser.ts#L2304
// and https://github.com/y-lohse/inkjs/blob/master/src/compiler/Parser/InkParser.ts#L370
const INPUT_ACTION_TAG_REGEXP =
	/^input:\s*(text)\s*,\s*(?<variable>[\w\u0041-\u007A\u0100-\u017F\u0180-\u024F\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u0590-\u05FF\u0600-\u06FF\uAC00-\uD7AF]+)$/;

const INK_IDENTIFIER_EXCLUDED_CHARACTERS_REGEXP =
	/^[\u005B-\u0060\u0378-\u0385\u0374\u0375\u0378\u0387\u038B\u038D\u03A2\u0482-\u0489\u0530\u0557-\u0560\u0588-\u058E]+$/;

const DIGITS_REGEXP = /^[0-9]+$/;

const SPEECH_TAG_REGEXP = /^speech:\s*([^,]+)(?:\s*,\s*(?<size>small|medium|large))?$/i;

/**
 * Parses definitions of characters of the story from the global tags of the story.
 * @returns A map mapping the name of the character to an object with more information, like a icon URL or a colour to use for that character.
 */
export function parseCharacters(inkStory: Story) {
	const characters = new Map<string, StoryCharacter>();

	if (inkStory.globalTags) {
		for (const tag of inkStory.globalTags) {
			let match = tag.match(CHARACTER_TAG_REGEXP);
			if (match) {
				const id = match[1].trim();
				// TODO later: restrict length of character name.
				//  https://discord.com/developers/docs/resources/channel#embed-object-embed-limits -> author name can hold up to 256 chars.
				const name = match[2].trim();
				const character: StoryCharacter = { id, name };
				if (match.groups.url) {
					character.imageUrl = match.groups.url;
				}
				if (match.groups.colour) {
					character.colour = ((match.groups.colour.startsWith('#') ? '' : '#') + match.groups.colour) as HexColorString;
				}
				characters.set(id, character);
			} else {
				match = tag.match(CHARACTER_TAG_REGEXP_LEGACY);
				if (match) {
					// TODO later: restrict length of character name.
					//  https://discord.com/developers/docs/resources/channel#embed-object-embed-limits -> author name can hold up to 256 chars.
					const name = match[1] ? match[1].trim() : match[2].trim();
					const id = name;
					const character: StoryCharacter = { id, name };
					if (match.groups.url) {
						character.imageUrl = match.groups.url;
					}
					if (match.groups.colour) {
						character.colour = ((match.groups.colour.startsWith('#') ? '' : '#') +
							match.groups.colour) as HexColorString;
					}
					characters.set(id, character);
				}
			}
		}
	}

	return characters;
}

export function parseLineSpeech(line: StoryLine, characters: Map<string, StoryCharacter>): LineSpeech | null {
	let text = line.text;
	let character: StoryCharacter | null = null;
	let characterImageSize: CharacterImageSize = 'small';

	if (line.tags) {
		for (const tag of line.tags) {
			const match = tag.match(SPEECH_TAG_REGEXP);
			if (match) {
				const characterId = match[1].trim();
				character = characters.get(characterId) ?? null;
				if (character && match.groups.size) {
					// We know the regexp only allows values contained in that type.
					characterImageSize = match.groups.size as CharacterImageSize;
				}
			}
		}
	}

	if (!character) {
		const separatorIndex = text.indexOf(':');
		if (separatorIndex > 0) {
			const characterId = text.substring(0, separatorIndex).trim();
			character = characters.get(characterId) ?? null;
			if (character) {
				text = text.substring(separatorIndex + 1).trim();
			}
		}
	}

	if (character) {
		return {
			text,
			character,
			characterImageSize
		};
	}

	return null;
}

export function parseDefaultButtonStyle(inkStory: Story): ChoiceButtonStyle {
	if (inkStory.globalTags) {
		for (const tag of inkStory.globalTags) {
			const match = tag.match(DEFAULT_BUTTON_STYLE_TAG_REGEXP);
			if (match) {
				return match[1].toLowerCase() as ChoiceButtonStyle;
			}
		}
	}
	return '';
}

export function parseChoiceButtonStyle(choice: Choice): ChoiceButtonStyle {
	if (choice.tags) {
		for (const tag of choice.tags) {
			const match = tag.match(BUTTON_STYLE_TAG_REGEXP);
			if (match) {
				return match[1].toLowerCase() as ChoiceButtonStyle;
			}
		}
	}
	return '';
}

export function parseChoiceAction(choice: Choice): ChoiceAction {
	if (choice.tags) {
		for (const tag of choice.tags) {
			const match = tag.match(INPUT_ACTION_TAG_REGEXP);
			if (match) {
				const variableName = match.groups.variable;
				// See algorithm for parsing identifiers in ink:
				// https://github.com/y-lohse/inkjs/blob/master/src/compiler/Parser/InkParser.ts#L2785C20
				if (!variableName.match(DIGITS_REGEXP) && !variableName.match(INK_IDENTIFIER_EXCLUDED_CHARACTERS_REGEXP)) {
					return {
						input: {
							type: 'text',
							variableName
						}
					};
				}
			}
		}
	}
	return {};
}

export function parseMetadata(inkStory: Story) {
	const metadata: StoryMetadata = {
		title: '',
		author: '',
		teaser: ''
	};

	if (inkStory.globalTags) {
		for (const tag of inkStory.globalTags) {
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
