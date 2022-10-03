import { expect, assert } from 'chai';
import { Constants } from 'discord.js';
import fs from 'fs';
import { getMessagesToSend } from '../../story/story-message-sender.js';
import {
	ACTION_ROW_BUTTON_LIMIT,
	BUTTON_LABEL_CHARACTER_LIMIT,
	MESSAGE_ACTION_ROW_LIMIT
} from '../../util/discord-constants.js';

const over2kChars = fs.readFileSync('./test/story/over2kchars.txt', 'utf8');
const over1kChars = over2kChars.substring(0, 1004);
const over4kChars = over2kChars + over2kChars;
const oneHundredChars = over2kChars.substring(0, 100);

describe('story-message-sender', () => {
	describe('getMessagesToSend()', () => {
		const mockT = {
			user: function user(key, options) {
				if (key === 'choice-button-indexed-label') {
					return options.choiceIndex + '. ' + options.choiceText;
				}
				return key + (options ? '#' + JSON.stringify(options) : '');
			}
		};
		const mockGetStoryButtonId = innerId => '/story#' + innerId;
		const mockStartButtonId = '/story#start 123 321';
		const getMessages = stepData => getMessagesToSend(stepData, mockT, mockGetStoryButtonId, mockStartButtonId);

		it('deals with no lines and choices', () => {
			const stepData = { lines: [], choices: [] };
			expect(getMessages(stepData)).to.be.an('array').that.is.empty;
		});

		it('ignores empty lines', () => {
			const stepData = {
				lines: [
					{ text: '', tags: [] },
					{ text: '  ', tags: [] }
				],
				choices: []
			};
			expect(getMessages(stepData)).to.be.an('array').that.is.empty;
		});

		it('creates a choice button message if no lines exist', () => {
			const stepData = { lines: [], choices: [{ index: 0, text: 'Pick me!' }] };
			expect(getMessages(stepData)).to.be.an('array').and.to.have.lengthOf(1);
		});

		it('restricts the choice button label length', () => {
			const stepData = {
				lines: [{ text: 'Test', tags: [] }],
				choices: [
					{
						index: 0,
						// Just some text that is longer than BUTTON_LABEL_CHARACTER_LIMIT
						text: 'Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz Click me now! Go ahead!'
					},
					{
						index: 1,
						// This one is short enough and should appear in the button label in full.
						text: 'Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz'
					}
				]
			};
			const messages = getMessages(stepData);
			// It should ignore the message created for the line and create a new one (for the full choice text).
			expect(messages).to.be.an('array').and.to.have.lengthOf(2);
			expect(messages[1].components[0].components[0].label).to.have.lengthOf.at.most(BUTTON_LABEL_CHARACTER_LIMIT);
			expect(messages[1].components[0].components[1].label).to.equal('2. ' + stepData.choices[1].text);
		});

		it('restricts the number of choice buttons', () => {
			const choiceLimit = ACTION_ROW_BUTTON_LIMIT * MESSAGE_ACTION_ROW_LIMIT;
			const stepData = {
				lines: [],
				choices: []
			};
			for (let i = 0; i < choiceLimit + 1; i++) {
				stepData.choices.push({ index: i, text: '' + i });
			}
			assert.isAbove(stepData.choices.length, choiceLimit);
			const messages = getMessages(stepData);
			// We get the message for the buttoms and then a warning message below.
			expect(messages).to.be.an('array').and.to.have.lengthOf(2);
			expect(messages[0].components).to.have.lengthOf(MESSAGE_ACTION_ROW_LIMIT);
			for (const component of messages[0].components) {
				expect(component.components).to.have.lengthOf(ACTION_ROW_BUTTON_LIMIT);
			}
		});

		it('attaches choice buttons to the right last message', () => {
			const stepData = {
				lines: [
					{ text: 'Line 1', tags: [] },
					{ text: 'Line 2', tags: ['pause'] },
					{ text: '', tags: ['pause'] }
				],
				choices: [{ index: 0, text: 'Pick me!' }]
			};

			// Creates messages for: 'Line 1', delay, 'Line 2', delay, buttons.
			// Buttons can't attach to delay handling message.
			expect(getMessages(stepData)).to.be.an('array').and.to.have.lengthOf(5);

			stepData.lines[2].text = 'Line 3';
			const messages = getMessages(stepData);
			// Creates messages for: 'Line 1', delay, 'Line 2', delay, 'Line 3' + buttons.
			expect(messages).to.be.an('array').and.to.have.lengthOf(5);
			// Buttons can now attach to last message.
			expect(messages[4].content).to.equal('Line 3');
			expect(messages[4].components).to.have.lengthOf(1);
		});

		it('applies button styles correctly', () => {
			const stepData = {
				lines: [{ text: '', tags: ['default-button-style:primary'] }],
				choices: [
					{ index: 0, text: 'Pick me!' },
					{ index: 1, text: "style-danger:Don't pick me!" }
				],
				defaultButtonStyle: 'primary'
			};
			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[0].components[0].components[0].label).to.equal('Pick me!');
			expect(messages[0].components[0].components[0].style).to.equal(Constants.MessageButtonStyles.PRIMARY);
			expect(messages[0].components[0].components[1].label).to.equal("Don't pick me!");
			expect(messages[0].components[0].components[1].style).to.equal(Constants.MessageButtonStyles.DANGER);
		});

		it('combines and splits lines as necessary', () => {
			const stepData = {
				lines: [
					// The next two lines should get combined into a single message.
					{ text: 'First line', tags: [] },
					{ text: 'Second line', tags: [] },
					// This line is too large to attach it to the previous message, so it stands on its own.
					// But it's also too large to fit into a single message, so it gets split at the limit and the rest goes into the next message.
					{ text: over2kChars, tags: [] },
					// The next two lines get combined with each other and the rest of the previous line into a new message.
					{ text: 'Two lines with slightly over 1k chars each come next.', tags: [] },
					{ text: over1kChars, tags: [] },
					// This line fits into a message but is too large to be able to get combined into the previous message.
					// It can, however, get combined with the last line.
					{ text: over1kChars, tags: [] },
					{ text: 'Last line', tags: [] }
				],
				choices: []
			};
			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(4);
			expect(messages[0].content).to.equal('First line\nSecond line');
			expect(messages[1].content.startsWith('Lorem ipsum')).to.be.true;
			expect(messages[2].content).to.have.string('Two lines with slightly over 1k chars each come next.');
			expect(messages[2].content).to.have.string(over1kChars);
			expect(messages[3].content.startsWith(over1kChars)).to.be.true;
			expect(messages[3].content.endsWith('Last line')).to.be.true;
			for (const message of messages) {
				expect(message.content).to.have.lengthOf.below(2000);
			}
		});

		it('recognises character speech lines correctly', () => {
			const characters = new Map();
			characters.set('Darth Vader', {
				name: 'Darth Vader',
				colour: '#000000'
			});
			characters.set('Bard', {
				name: 'Bard',
				iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Frans_Hals_-_Luitspelende_nar.jpg'
			});
			const stepData = {
				lines: [
					{ text: 'Bard: What do we have here then?', tags: [] },
					{ text: 'Darth Vader:I am your father!', tags: [] },
					// No character named 'Luke' defined so this should be printed as a regular line.
					{ text: "Luke: No... no... that's not true!", tags: [] }
				],
				choices: [],
				characters
			};

			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(3);

			expect(messages[0].content).to.be.undefined;
			expect(messages[0].embeds).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[0].embeds[0].description).to.equal('What do we have here then?');
			expect(messages[0].embeds[0].author.name).to.equal('Bard');
			expect(messages[0].embeds[0].author.iconURL).to.equal(
				'https://upload.wikimedia.org/wikipedia/commons/6/6a/Frans_Hals_-_Luitspelende_nar.jpg'
			);
			expect(messages[0].embeds[0].color).to.be.null;

			expect(messages[1].content).to.be.undefined;
			expect(messages[1].embeds).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[1].embeds[0].description).to.equal('I am your father!');
			expect(messages[1].embeds[0].author.name).to.equal('Darth Vader');
			expect(messages[1].embeds[0].author.iconURL).to.be.undefined;
			expect(messages[1].embeds[0].color).to.equal(0);

			expect(messages[2].content).to.equal("Luke: No... no... that's not true!");
			expect(messages[2].embeds).to.be.undefined;
		});

		it('can put choice buttons on character speech embeds', () => {
			const characters = new Map();
			characters.set('Bard', { name: 'Bard' });
			const stepData = {
				lines: [{ text: 'Bard: Yes?', tags: [] }],
				choices: [{ index: 0, text: 'Can you play a song?' }],
				characters
			};
			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[0].embeds).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[0].components).to.be.an('array').and.to.have.lengthOf(1);
		});

		it('ignores empty character speech lines', () => {
			const characters = new Map();
			characters.set('Bard', { name: 'Bard' });
			const stepData = {
				lines: [{ text: 'Bard: ', tags: [] }],
				choices: [],
				characters
			};
			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(0);
		});

		it('combines multiple character speech lines of the same character into one embed', () => {
			const characters = new Map();
			characters.set('Bard', { name: 'Bard' });
			const stepData = {
				lines: [
					{ text: 'Bard: Speech line 1', tags: [] },
					{ text: 'Bard: Speech line 2', tags: [] }
				],
				choices: [],
				characters
			};
			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[0].embeds).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[0].embeds[0].description).to.equal('Speech line 1\nSpeech line 2');
		});

		it('does not combine character speech with regular lines', () => {
			const characters = new Map();
			characters.set('Bard', { name: 'Bard' });
			const stepData = {
				lines: [
					{ text: 'Regular line 1', tags: [] },
					{ text: 'Regular line 2', tags: [] },
					{ text: 'Bard: Speech line 1', tags: [] },
					{ text: 'Regular line 3', tags: [] },
					{ text: 'Regular line 4', tags: [] },
					{ text: 'Bard: Speech line 2', tags: [] }
				],
				choices: [],
				characters
			};
			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(4);
			expect(messages[1].embeds).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[3].embeds).to.be.an('array').and.to.have.lengthOf(1);
		});

		it('splits character speech lines as necessary', () => {
			const characters = new Map();
			characters.set('Bard', { name: 'Bard' });
			const stepData = {
				lines: [
					// This line should be split because the limit for a character embed is 4096.
					{ text: 'Bard: ' + over4kChars + oneHundredChars, tags: [] },
					// This line can be combined with the rest of the previous line.
					{ text: 'Bard: ' + over2kChars + oneHundredChars, tags: [] },
					// Adding this to the previous line wouldn't work as the result would be over 4096 chars long,
					// so this will be on a line of its own.
					{ text: 'Bard: ' + over2kChars, tags: [] }
				],
				choices: [],
				characters
			};
			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(3);
			expect(messages[2].embeds[0].description.startsWith('Lorem ipsum')).to.be.true;
			expect(messages[2].embeds[0].description.endsWith('qui')).to.be.true;
			for (const message of messages) {
				expect(message.embeds[0].description).to.have.lengthOf.below(4096);
			}
		});

		it('does not combine lines annotated with the standalone tag with other lines', () => {
			const stepData = {
				lines: [
					{ text: 'First line', tags: [] },
					{ text: 'Second line', tags: ['standalone'] },
					{ text: 'Third line', tags: [] }
				],
				choices: []
			};
			let messages = getMessages(stepData);
			// Make sure that none of these lines get combined.
			expect(messages).to.be.an('array').and.to.have.lengthOf(3);
			expect(messages[0].content).to.equal('First line');
			expect(messages[1].content).to.equal('Second line');
			expect(messages[2].content).to.equal('Third line');

			// We now have a text that wraps to two messages and is annotated with standalone.
			// Make sure the third line doesn't combine with the wrapped message.
			stepData.lines[1].text = over2kChars;
			messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(4);
			expect(messages[0].content).to.equal('First line');
			expect(messages[1].content.startsWith('Lorem ipsum')).to.be.true;
			expect(messages[2].content.endsWith('qui')).to.be.true;
			expect(messages[3].content).to.equal('Third line');
		});

		it('does not combine character speech lines annotated with the standalone tag with other lines by the same character', () => {
			const characters = new Map();
			characters.set('Bard', { name: 'Bard' });
			const stepData = {
				lines: [
					{ text: 'Bard: Speech line 1', tags: [] },
					{ text: 'Bard: Speech line 2', tags: ['standalone'] },
					{ text: 'Bard: Speech line 3', tags: [] }
				],
				choices: [],
				characters
			};
			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(3);
		});

		it('treats URLs as standalone lines', () => {
			const stepData = {
				lines: [
					{ text: 'First line', tags: [] },
					{ text: 'Second line contains a URL: http://example.com/ and some more text', tags: [] },
					{ text: 'Third line', tags: [] }
				],
				choices: [],
				characters: new Map()
			};
			let messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(3);
			expect(messages[0].content).to.equal('First line');
			expect(messages[1].content).to.equal('Second line contains a URL: http://example.com/ and some more text');
			expect(messages[2].content).to.equal('Third line');
		});

		it('treats URLs in character speech as standalone lines', () => {
			const characters = new Map();
			characters.set('Bard', { name: 'Bard' });
			const stepData = {
				lines: [
					{ text: 'Bard: Speech line 1', tags: [] },
					{ text: 'Bard: http://example.com', tags: [] },
					{ text: 'Bard: Speech line 3', tags: [] }
				],
				choices: [],
				characters
			};
			const messages = getMessages(stepData);
			console.log(messages[0]);
			expect(messages).to.be.an('array').and.to.have.lengthOf(3);
		});

		it('handles pause tags as special messages', () => {
			const stepData = {
				lines: [
					{ text: 'First line', tags: [] },
					{ text: 'This line will appear after a pause', tags: ['pause'] },
					{ text: 'Last line', tags: [] }
				],
				choices: []
			};
			let messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(3);
			expect(messages[0].content).to.equal('First line');
			expect(messages[1].content).to.be.undefined;
			expect(messages[1].specialHandling).to.equal('Delay');
			expect(messages[2].content).to.equal('This line will appear after a pause\nLast line');

			// Just to test standalone tag in combination with pause tag
			stepData.lines[1].tags.push('standalone');
			messages = getMessages(stepData);
			expect(messages[0].content).to.equal('First line');
			expect(messages[1].content).to.be.undefined;
			expect(messages[1].specialHandling).to.equal('Delay');
			expect(messages[2].content).to.equal('This line will appear after a pause');
			expect(messages[3].content).to.equal('Last line');
		});

		it('handles pause tags on character speech lines as special messages', () => {
			const characters = new Map();
			characters.set('Bard', { name: 'Bard' });
			const stepData = {
				lines: [
					{ text: 'Bard: Speech line 1', tags: [] },
					{ text: 'Bard: Speech line 2', tags: ['pause'] },
					{ text: 'Bard: Speech line 3', tags: [] }
				],
				choices: [],
				characters
			};
			let messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(3);
			expect(messages[0].embeds[0].description).to.equal('Speech line 1');
			expect(messages[1].specialHandling).to.equal('Delay');
			expect(messages[2].embeds[0].description).to.equal('Speech line 2\nSpeech line 3');
		});

		it('appends an end message in the right place', () => {
			const stepData = {
				lines: [{ text: 'Test', tags: [] }],
				choices: [{ index: 0, text: 'Pick me!' }],
				isEnd: true
			};
			const messages = getMessages(stepData);
			expect(messages).to.be.an('array').and.to.have.lengthOf(2);
			expect(messages[0].components).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[1].embeds).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[1].components).to.be.an('array').and.to.have.lengthOf(1);
			expect(messages[1].components[0].components[0].custom_id).to.equal(mockStartButtonId);
		});
	});
});
