import { hyperlink } from '@discordjs/builders';
import { Constants } from 'discord.js';

const notationExpression = /^\s*([1-9]\d*)?d(2|4|6|8|10|12|20)\s*$/i;
const MAX_NUMBER_OF_DICE = 20;

const rollCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'roll',
		description: `Roll some dice! You can roll up to ${MAX_NUMBER_OF_DICE} dice at a time.`,
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'notation',
				description: `Describe which and how many dice to roll, using D&D dice notation. E.g. "d4" or "3d20".`,
				type: Constants.ApplicationCommandOptionTypes.STRING,
				required: true
			}
		]
	},
	// Handler for when the command is used
	async execute(interaction) {
		const notation = interaction.options.getString('notation');
		const matches = notation.match(notationExpression);

		if (matches === null) {
			await interaction.reply({
				content:
					'Could not recognise your input.\n' +
					` This command uses ${hyperlink('dice notation', 'https://en.wikipedia.org/wiki/Dice_notation')}` +
					' as used by many tabletop games, but only basic versions of it like "d6" or "3d20".' +
					' The dice available are the standard Dungeons & Dragons ones: d2, d4, d6, d8, d10, d12 and d20.' +
					' You can roll up to 20 dice at a time. You cannot roll multiple dice with different numbers of faces at once.',
				ephemeral: true
			});
		} else {
			let numberOfDiceString = matches[1];
			if (typeof numberOfDiceString === 'undefined') {
				numberOfDiceString = '1';
			}
			const numberOfDice = parseInt(numberOfDiceString);
			const numberOfFaces = parseInt(matches[2]);
			if (isNaN(numberOfDice) || isNaN(numberOfFaces)) {
				// This should be prevented by the regular expression really...
				await interaction.reply({
					content: 'Number of dice or number or faces is not a valid number.',
					ephemeral: true
				});
			} else if (numberOfDice > MAX_NUMBER_OF_DICE) {
				await interaction.reply({
					content: `Unfortunately you can only roll up to ${MAX_NUMBER_OF_DICE} dice at a time.`,
					ephemeral: true
				});
			} else {
				const result = diceRoll(numberOfDice, numberOfFaces);

				let message;
				if (numberOfDice === 1) {
					message =
						`${interaction.member.displayName} rolls a ${numberOfFaces}-sided dice.\n` + `The result is: ${result[0]}`;
				} else {
					message =
						`${interaction.member.displayName} rolls ${numberOfDice} ${numberOfFaces}-sided dice.\n` +
						`The result is: ${result.join(' + ')} = ${sum(result)}`;
				}

				await interaction.reply({
					content: message
				});
			}
		}
	}
};

function diceRoll(numberOfDice, numberOfFaces) {
	const result = [];
	for (let i = 0; i < numberOfDice; i++) {
		result.push(Math.floor(Math.random() * numberOfFaces) + 1);
	}
	return result;
}

function sum(diceRollResult) {
	var result = 0;
	for (let i = 0; i < diceRollResult.length; i++) {
		result += diceRollResult[i];
	}
	return result;
}

export default rollCommand;
