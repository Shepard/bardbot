import { HexColorString } from 'discord.js';
import { Story } from '@shepard4711/inkjs/engine/Story.js';
import { Choice } from '@shepard4711/inkjs/engine/Choice.js';
import { StoryMetadata, StoryCharacter, ChoiceButtonStyle } from './story-types.js';

/**
 * For parsing character definitions from global tags.
 * If the name needs spaces it can be wrapped in double quotes.
 * URL and colour value are optional. The "#" of the colour value is optional because it needs to be escaped in Ink which is awkward.
 * Examples:
 * CHARACTER:Doctor
 * charactEr: "Darth Vader" 000000
 * Character:  Robespierre https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Robespierre_Ducreux.jpeg/181px-Robespierre_Ducreux.jpeg
 * character: "Elizabeth II" https://upload.wikimedia.org/wikipedia/commons/6/66/Queen_Elizabeth_II_on_3_June_2019.jpg #9cc6c5
 */
const CHARACTER_TAG_REGEXP =
	/^character:\s*(?:([^\s]+)|(?:"([^"]+)"))(?:\s+(?<url>http[^\s]+))?(?:\s+(?<colour>#?[0-9a-fA-F]{6}))?$/i;

const TITLE_TAG_REGEXP = /^title:(.+)$/i;

const AUTHOR_TAG_REGEXP = /^author:(.+)$/i;

const TEASER_TAG_REGEXP = /^teaser:(.+)$/i;

const DEFAULT_BUTTON_STYLE_TAG_REGEXP = /^default-button-style:\s*(primary|secondary|success|danger)$/i;

const BUTTON_STYLE_TAG_REGEXP = /^button-style:\s*(primary|secondary|success|danger)$/i;

/**
 * Parses definitions of characters of the story from the global tags of the story.
 * @returns A map mapping the name of the character to an object with more information, like a icon URL or a colour to use for that character.
 */
export function parseCharacters(inkStory: Story) {
	const characters = new Map<string, StoryCharacter>();

	if (inkStory.globalTags) {
		for (let tag of inkStory.globalTags) {
			const match = tag.match(CHARACTER_TAG_REGEXP);
			if (match) {
				// TODO later: restrict length of character name.
				//  https://discord.com/developers/docs/resources/channel#embed-object-embed-limits -> author name can hold up to 256 chars.
				const name = match[1] ? match[1].trim() : match[2].trim();
				const character: StoryCharacter = { name };
				if (match.groups.url) {
					character.iconUrl = match.groups.url;
				}
				if (match.groups.colour) {
					character.colour = ((match.groups.colour.startsWith('#') ? '' : '#') + match.groups.colour) as HexColorString;
				}
				characters.set(name, character);
			}
		}
	}

	return characters;
}

export function parseDefaultButtonStyle(inkStory: Story): ChoiceButtonStyle {
	if (inkStory.globalTags) {
		for (let tag of inkStory.globalTags) {
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
		for (let tag of choice.tags) {
			const match = tag.match(BUTTON_STYLE_TAG_REGEXP);
			if (match) {
				return match[1].toLowerCase() as ChoiceButtonStyle;
			}
		}
	}
	return '';
}

export function parseMetadata(inkStory: Story) {
	const metadata: StoryMetadata = {
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
