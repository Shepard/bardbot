import { expect } from 'chai';
import { parseCharacters, parseDefaultButtonStyle, parseMetadata } from '../../story/story-information-extractor.js';

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
				globalTags: ['character: Peter', 'CHARACTER:"Peter Parker"', 'author', 'character:   Spider-Man f00']
			};
			const characters = parseCharacters(inkStory);
			expect(characters).to.be.a('Map').and.to.have.lengthOf(3);
			expect(characters).to.have.all.keys('Peter', 'Peter Parker', 'Spider-Man');
		});
		it('detects different combinations of parameters correctly', () => {
			let inkStory = {
				globalTags: ['character: Peter']
			};
			let characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter' });

			inkStory = {
				globalTags: ['character: Peter f00']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter', colour: '#f00' });

			inkStory = {
				globalTags: ['character: Peter http://test.com/peter.png']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter', iconUrl: 'http://test.com/peter.png' });

			inkStory = {
				globalTags: ['character: Peter http://test.com/peter.png f00']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter', iconUrl: 'http://test.com/peter.png', colour: '#f00' });

			inkStory = {
				globalTags: ['character: "Peter Parker"']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter Parker' });

			inkStory = {
				globalTags: ['character: "Peter Parker" f00']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter Parker', colour: '#f00' });

			inkStory = {
				globalTags: ['character: "Peter Parker" http://test.com/peter.png']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter Parker', iconUrl: 'http://test.com/peter.png' });

			inkStory = {
				globalTags: ['character: "Peter Parker" http://test.com/peter.png f00']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({
				name: 'Peter Parker',
				iconUrl: 'http://test.com/peter.png',
				colour: '#f00'
			});
		});
		it('detects colour values correctly', () => {
			let inkStory = {
				globalTags: ['character: Peter #F00']
			};
			let characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter', colour: '#F00' });

			inkStory = {
				globalTags: ['character: Peter 00Ff00']
			};
			characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter', colour: '#00Ff00' });
		});
		it('only keeps the last character of the same name', () => {
			const inkStory = {
				globalTags: ['character: Peter #F00', 'character: Peter #00F']
			};
			const characters = parseCharacters(inkStory);
			expect(characters).to.deep.include({ name: 'Peter', colour: '#00F' });
			expect(characters).to.not.deep.include({ name: 'Peter', colour: '#F00' });
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
