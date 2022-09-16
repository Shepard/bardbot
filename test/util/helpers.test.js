import { expect } from 'chai';
import { chunk, codePointLength, trimText, splitTextAtWhitespace } from '../../util/helpers.js';

describe('helpers', () => {
	describe('chunk()', () => {
		it('can handle an empty array', () => {
			expect(chunk([], 0)).to.be.empty;
			expect(chunk([], 1)).to.be.empty;
			expect(chunk([], 5)).to.be.empty;
		});
		it('chunks arrays correctly', () => {
			expect(chunk([1], 0)).to.be.empty;
			expect(chunk([1], 1)).to.have.deep.members([[1]]);
			expect(chunk([1], 3)).to.have.deep.members([[1]]);
			expect(chunk([1, 2], 3)).to.have.deep.members([[1, 2]]);
			expect(chunk([1, 2, 3], 3)).to.have.deep.members([[1, 2, 3]]);
			expect(chunk([1, 2, 3, 4], 3)).to.have.deep.members([[1, 2, 3], [4]]);
			expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).to.have.deep.members([[1, 2, 3], [4, 5, 6], [7]]);
		});
	});

	describe('codePointLength()', () => {
		it('can handle an empty string', () => {
			expect(codePointLength('')).to.be.equal(0);
		});
		it('count surrogate pairs correctly', () => {
			// First confirm that this string is two UTF-16 characters long using normal length measuring.
			expect('🤖'.length).to.be.equal(2);
			// Now check that out method counts code points correctly.
			expect(codePointLength('🤖')).to.be.equal(1);

			// And some longer example
			expect('ab🤖cd'.length).to.be.equal(6);
			expect(codePointLength('ab🤖cd')).to.be.equal(5);
		});
	});

	describe('trimText()', () => {
		it('can handle an empty string', () => {
			expect(trimText('', 0)).to.be.equal('');
			expect(trimText('', 1)).to.be.equal('');
			expect(trimText('', 5)).to.be.equal('');
		});
		it("doesn't trim strings that are short enough", () => {
			expect(trimText('a', 1)).to.be.equal('a');
			expect(trimText('a', 3)).to.be.equal('a');
			expect(trimText('ab', 3)).to.be.equal('ab');
			expect(trimText('ab🤖', 3)).to.be.equal('ab🤖');
		});
		it('can trim strings', () => {
			expect(trimText('a', 0)).to.be.equal('');
			expect(trimText('abc', 1)).to.be.equal('…');
			expect(trimText('abc', 2)).to.be.equal('a…');
		});
		it('can trim strings with surrogate pairs', () => {
			expect(trimText('ab🤖', 1)).to.be.equal('…');
			expect(trimText('ab🤖', 2)).to.be.equal('a…');
			expect(trimText('ab🤖c', 3)).to.be.equal('ab…');
			expect(trimText('ab🤖cd', 4)).to.be.equal('ab🤖…');
		});
	});

	describe('splitTextAtWhitespace()', () => {
		it('can handle an empty string', () => {
			expect(splitTextAtWhitespace('', 0)).to.be.empty;
			expect(splitTextAtWhitespace('', 1)).to.be.empty;
			expect(splitTextAtWhitespace('', 5)).to.be.empty;
		});
		it("doesn't split a short enough string", () => {
			expect(splitTextAtWhitespace('abc', 5)).to.have.members(['abc']);
			expect(splitTextAtWhitespace('abcde', 5)).to.have.members(['abcde']);
		});
		it('can split a string without whitespace', () => {
			expect(splitTextAtWhitespace('abcde', 3)).to.have.members(['abc', 'de']);
			expect(splitTextAtWhitespace('abcdef', 3)).to.have.members(['abc', 'def']);
			expect(splitTextAtWhitespace('abcdefg', 3)).to.have.members(['abc', 'def', 'g']);
		});
		it('can split a string at spaces', () => {
			expect(splitTextAtWhitespace('a bcd', 3)).to.have.members(['a', 'bcd']);
			expect(splitTextAtWhitespace('ab cde', 3)).to.have.members(['ab', 'cde']);
			expect(splitTextAtWhitespace('abc de', 3)).to.have.members(['abc', 'de']);
			expect(splitTextAtWhitespace('abcd e', 3)).to.have.members(['abc', 'd e']);
			expect(splitTextAtWhitespace('ab cdef', 6)).to.have.members(['ab', 'cdef']);
			// This one would be better as ['ab cde', 'f'] since the first part fits into 6 characters and the space comes after.
			expect(splitTextAtWhitespace('ab cde f', 6)).to.have.members(['ab', 'cde f']);
			expect(splitTextAtWhitespace('ab cd ef gh ij kl', 10)).to.have.members(['ab cd ef', 'gh ij kl']);
		});
		it('can split a string at other whitespace', () => {
			expect(splitTextAtWhitespace('ab\tcde', 3)).to.have.members(['ab', 'cde']);
			expect(splitTextAtWhitespace('ab\ncde', 3)).to.have.members(['ab', 'cde']);
		});
		it('prioritises line-breaks', () => {
			// Line-break takes precedence over space.
			expect(splitTextAtWhitespace('a b\ncde', 5)).to.have.members(['a b', 'cde']);
			expect(splitTextAtWhitespace('a\nb cde', 5)).to.have.members(['a', 'b cde']);
			// Second line-break overrides previous one and whitespaces are kept correctly.
			expect(splitTextAtWhitespace('a\nb c\nde f', 6)).to.have.members(['a\nb c', 'de f']);
			// And a longer example to make sure buffers are reset correctly etc.
			expect(splitTextAtWhitespace('a\nb c\nde fghij', 6)).to.have.members(['a\nb c', 'de', 'fghij']);
		});
		it('can deal with surrogate pairs', () => {
			expect(splitTextAtWhitespace('a🤖bc', 3)).to.have.members(['a🤖b', 'c']);
			expect(splitTextAtWhitespace('ab🤖c', 3)).to.have.members(['ab🤖', 'c']);
			expect(splitTextAtWhitespace('abc🤖', 3)).to.have.members(['abc', '🤖']);
		});
		it('can deal with surrogate pairs and whitespace', () => {
			expect(splitTextAtWhitespace('a🤖 bc', 3)).to.have.members(['a🤖', 'bc']);
			expect(splitTextAtWhitespace('a 🤖bc', 3)).to.have.members(['a', '🤖bc']);
		});
		it('deals with whitespace only in some way', () => {
			// These are ugly. Mainly just documenting the current behaviour.
			expect(splitTextAtWhitespace('   ', 3)).to.have.members(['   ']);
			expect(splitTextAtWhitespace('    ', 3)).to.have.members(['  ']);
			expect(splitTextAtWhitespace(' \t  ', 3)).to.have.members([' \t']);
			expect(splitTextAtWhitespace(' \n  ', 3)).to.have.members([' ', '  ']);
		});
		it('deals with leading and trailing whitespace in some way', () => {
			// Don't like this.
			//expect(splitTextAtWhitespace(' abc ', 3)).to.have.members(['abc', ' ']);
			expect(splitTextAtWhitespace('abc ', 3)).to.have.members(['abc']);
		});
	});
});
