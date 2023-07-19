import { expect } from 'chai';
import {
	parseCharacters,
	parseDefaultButtonStyle,
	parseChoiceButtonStyle,
	parseMetadata,
	parseLineSpeech
} from '../../built/story/story-information-extractor.js';

describe('story-information-extractor', () => {
	describe('parseCharacters()', () => {
		it('returns an empty map when no global tags are defined', () => {
			let inkStory = {};
			expect(parseCharacters(inkStory)).to.be.a('Map').that.is.empty;
			inkStory = {
				globalTags: []
			};
			expect(parseCharacters(inkStory)).to.be.a('Map').that.is.empty;
		});
		it('returns an empty map when no characters are defined in global tags', () => {
			const inkStory = {
				globalTags: ['author', 'title: Test', 'teaser']
			};
			expect(parseCharacters(inkStory)).to.be.a('Map').that.is.empty;
		});
		it('rejects invalid characters', () => {
			const inkStory = {
				globalTags: ['character:', 'character a', 'character: a _', 'character: a #aa', 'character: a #äää']
			};
			expect(parseCharacters(inkStory)).to.be.a('Map').that.is.empty;
		});
		it('finds valid characters', () => {
			const inkStory = {
				globalTags: [
					'character: Peter',
					'CHARACTER:"Peter Parker"',
					'author',
					'character:   Spider-Man ff0000',
					'character:vader,Darth Vader',
					'character: Luke , Luke Skywalker , ff0000'
				]
			};
			const characters = parseCharacters(inkStory);
			expect(characters).to.be.a('Map').and.to.have.lengthOf(5);
			expect(characters).to.have.all.keys('Peter', 'Peter Parker', 'Spider-Man', 'vader', 'Luke');
		});
		it('detects different combinations of parameters correctly', () => {
			// Legacy syntax

			let inkStory = {
				globalTags: ['character: Peter']
			};
			let characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter', name: 'Peter' });

			inkStory = {
				globalTags: ['character: Peter ff0000']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter', name: 'Peter', colour: '#ff0000' });

			inkStory = {
				globalTags: ['character: Peter http://test.com/peter.png']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter', name: 'Peter', imageUrl: 'http://test.com/peter.png' });

			inkStory = {
				globalTags: ['character: Peter http://test.com/peter.png ff0000']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({
				id: 'Peter',
				name: 'Peter',
				imageUrl: 'http://test.com/peter.png',
				colour: '#ff0000'
			});

			// Legacy syntax with quoted name

			inkStory = {
				globalTags: ['character: "Peter Parker"']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter Parker', name: 'Peter Parker' });

			inkStory = {
				globalTags: ['character: "Peter Parker" ff0000']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter Parker', name: 'Peter Parker', colour: '#ff0000' });

			inkStory = {
				globalTags: ['character: "Peter Parker" http://test.com/peter.png']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({
				id: 'Peter Parker',
				name: 'Peter Parker',
				imageUrl: 'http://test.com/peter.png'
			});

			inkStory = {
				globalTags: ['character: "Peter Parker" http://test.com/peter.png ff0000']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({
				id: 'Peter Parker',
				name: 'Peter Parker',
				imageUrl: 'http://test.com/peter.png',
				colour: '#ff0000'
			});

			// New syntax

			inkStory = {
				globalTags: ['character: Peter, Peter Parker']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter', name: 'Peter Parker' });

			inkStory = {
				globalTags: ['character: Peter, Peter Parker, ff0000']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter', name: 'Peter Parker', colour: '#ff0000' });

			inkStory = {
				globalTags: ['character:Peter ,Peter Parker, http://test.com/peter.png']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter', name: 'Peter Parker', imageUrl: 'http://test.com/peter.png' });

			inkStory = {
				globalTags: ['character: Peter, Peter Parker , http://test.com/peter.png,ff0000']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({
				id: 'Peter',
				name: 'Peter Parker',
				imageUrl: 'http://test.com/peter.png',
				colour: '#ff0000'
			});
		});
		it('detects colour values correctly', () => {
			let inkStory = {
				globalTags: ['character: Peter #FF0000']
			};
			let characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter', name: 'Peter', colour: '#FF0000' });

			inkStory = {
				globalTags: ['character: Peter, Peter Parker, 00Ff00']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ id: 'Peter', name: 'Peter Parker', colour: '#00Ff00' });
		});
		it('only keeps the last character of the same name', () => {
			const inkStory = {
				globalTags: ['character: Peter #FF0000', 'character: Peter, Peter Parker, #0000FF']
			};
			const characters = parseCharacters(inkStory);
			expect(characters).to.not.deep.include({ id: 'Peter', name: 'Peter', colour: '#FF0000' });
			expect(characters).to.deep.include({ id: 'Peter', name: 'Peter Parker', colour: '#0000FF' });
		});
	});

	describe('parseLineSpeech', () => {
		it("doesn't find a character in empty line text and no tags", () => {
			const line = {
				text: '',
				tags: []
			};
			expect(parseLineSpeech(line, new Map())).to.be.null;
		});
		it("doesn't find a character in line text that doesn't exist", () => {
			const line = {
				text: 'Doctor: Who?',
				tags: []
			};
			expect(parseLineSpeech(line, new Map())).to.be.null;
		});
		it('finds character in line text', () => {
			const line = {
				text: 'Doctor : Who?',
				tags: []
			};
			const characters = new Map();
			const doctor = {
				id: 'Doctor',
				name: '10th Doctor'
			};
			characters.set('Doctor', doctor);

			const result = parseLineSpeech(line, characters);

			expect(result).to.not.be.null;
			expect(result.text).to.equal('Who?');
			expect(result.character).to.equal(doctor);
			expect(result.characterImageSize).to.equal('small');
		});
		it("doesn't find a character in tags that doesn't exist", () => {
			const line = {
				text: 'Who?',
				tags: ['speech:Doctor']
			};
			expect(parseLineSpeech(line, new Map())).to.be.null;
		});
		it("doesn't find a character in invalid speech tags", () => {
			const characters = new Map();
			const doctor = {
				id: 'Doctor',
				name: '10th Doctor'
			};
			characters.set('Doctor', doctor);
			let line = {
				text: 'Who?',
				tags: ['speech:Doctor,']
			};
			expect(parseLineSpeech(line, characters)).to.be.null;
			line = {
				text: 'Who?',
				tags: ['speech:,small']
			};
			expect(parseLineSpeech(line, characters)).to.be.null;
			line = {
				text: 'Who?',
				tags: ['speech:Doctor,huge']
			};
			expect(parseLineSpeech(line, characters)).to.be.null;
		});
		it('finds character in tags', () => {
			const line = {
				text: 'Who?',
				tags: ['speech:Doctor']
			};
			const characters = new Map();
			const doctor = {
				id: 'Doctor',
				name: '10th Doctor'
			};
			characters.set('Doctor', doctor);

			const result = parseLineSpeech(line, characters);

			expect(result).to.not.be.null;
			expect(result.text).to.equal('Who?');
			expect(result.character).to.equal(doctor);
			expect(result.characterImageSize).to.equal('small');
		});
		it('detects speech sizes correctly', () => {
			const characters = new Map();
			const doctor = {
				id: 'Doctor',
				name: '10th Doctor'
			};
			characters.set('Doctor', doctor);

			let line = {
				text: 'Who?',
				tags: ['speech:Doctor,small']
			};
			const result = parseLineSpeech(line, characters);
			expect(result.character).to.equal(doctor);
			expect(result.characterImageSize).to.equal('small');
			line = {
				text: 'Who?',
				tags: ['speech:Doctor,medium']
			};
			expect(parseLineSpeech(line, characters).characterImageSize).to.equal('medium');
			line = {
				text: 'Who?',
				tags: ['speech:Doctor,large']
			};
			expect(parseLineSpeech(line, characters).characterImageSize).to.equal('large');
		});
		it('prioritises character in tags', () => {
			const line = {
				text: 'Doctor: Who?',
				tags: ['speech:Peter']
			};
			const characters = new Map();
			const doctor = {
				id: 'Doctor',
				name: '10th Doctor'
			};
			characters.set('Doctor', doctor);
			const peter = {
				id: 'Peter',
				name: 'Peter Parker'
			};
			characters.set('Peter', peter);

			const result = parseLineSpeech(line, characters);

			expect(result).to.not.be.null;
			expect(result.text).to.equal('Doctor: Who?');
			expect(result.character).to.equal(peter);
			expect(result.characterImageSize).to.equal('small');
		});
	});

	describe('parseDefaultButtonStyle()', () => {
		it('returns an empty string when no global tags are defined', () => {
			let inkStory = {};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('');
			inkStory = {
				globalTags: []
			};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('');
		});
		it('returns an empty string when no default button style is defined in global tags', () => {
			const inkStory = {
				globalTags: ['author', 'title: Test', 'teaser']
			};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('');
		});
		it('rejects invalid default button styles', () => {
			let inkStory = {
				globalTags: ['default-button-style:']
			};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('');
			inkStory = {
				globalTags: ['default-button-style:aaa']
			};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('');
		});
		it('accepts valid default button styles', () => {
			let inkStory = {
				globalTags: ['default-button-style:primary']
			};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('primary');
			inkStory = {
				globalTags: ['default-BUTTON-style:  SeCoNdArY']
			};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('secondary');
			inkStory = {
				globalTags: ['default-button-style: success']
			};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('success');
			inkStory = {
				globalTags: ['default-button-style: danger']
			};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('danger');
		});
		it('only uses the first defined default button style', () => {
			const inkStory = {
				globalTags: ['default-button-style: danger', 'default-button-style: primary']
			};
			expect(parseDefaultButtonStyle(inkStory)).to.equal('danger');
		});
	});

	describe('parseChoiceButtonStyle()', () => {
		it('returns an empty string when no choice tags are defined', () => {
			let choice = {};
			expect(parseChoiceButtonStyle(choice)).to.equal('');
			choice = {
				tags: []
			};
			expect(parseChoiceButtonStyle(choice)).to.equal('');
		});
		it('returns an empty string when no button style is defined in choice tags', () => {
			const choice = {
				tags: ['foo', 'bar']
			};
			expect(parseChoiceButtonStyle(choice)).to.equal('');
		});
		it('rejects invalid choice button styles', () => {
			let choice = {
				tags: ['button-style:']
			};
			expect(parseChoiceButtonStyle(choice)).to.equal('');
			choice = {
				tags: ['button-style:aaa']
			};
			expect(parseChoiceButtonStyle(choice)).to.equal('');
		});
		it('accepts valid choice button styles', () => {
			let choice = {
				tags: ['button-style:primary']
			};
			expect(parseChoiceButtonStyle(choice)).to.equal('primary');
			choice = {
				tags: ['BUTTON-style:  SeCoNdArY']
			};
			expect(parseChoiceButtonStyle(choice)).to.equal('secondary');
			choice = {
				tags: ['button-style: success']
			};
			expect(parseChoiceButtonStyle(choice)).to.equal('success');
			choice = {
				tags: ['button-style: danger']
			};
			expect(parseChoiceButtonStyle(choice)).to.equal('danger');
		});
		it('only uses the first defined choice button style', () => {
			const choice = {
				tags: ['button-style: danger', 'button-style: primary']
			};
			expect(parseChoiceButtonStyle(choice)).to.equal('danger');
		});
	});

	describe('parseMetadata()', () => {
		it('returns empty metadata when no global tags are defined', () => {
			let inkStory = {};
			expect(parseMetadata(inkStory)).to.deep.equal({ title: '', author: '', teaser: '' });
			inkStory = {
				globalTags: []
			};
			expect(parseMetadata(inkStory)).to.deep.equal({ title: '', author: '', teaser: '' });
		});
		it('returns empty metadata when no metadata is defined in global tags', () => {
			let inkStory = {
				globalTags: ['character:Peter', 'default-button-style:primary']
			};
			expect(parseMetadata(inkStory)).to.deep.equal({ title: '', author: '', teaser: '' });
			inkStory = {
				globalTags: ['title:', 'author:  ', 'teaser: ']
			};
			expect(parseMetadata(inkStory)).to.deep.equal({ title: '', author: '', teaser: '' });
		});
		it('detects metadata in global tags', () => {
			const inkStory = {
				globalTags: ['title:Test', 'default-button-style:primary', 'teaser: Test Test', 'author:  Peter']
			};
			expect(parseMetadata(inkStory)).to.deep.equal({ title: 'Test', author: 'Peter', teaser: 'Test Test' });
		});
	});
});
