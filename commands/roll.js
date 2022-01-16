import { Constants } from 'discord.js';

// For now this notation is localised for English and German by allowing "d" and "w" as the dice type prefix.
// More letters can be added for other languages in the future (e.g. "t" for Swedish?).
const notationExpression = /^\s*([1-9]\d*)?(d|w)(2|4|6|8|10|12|20)\s*$/i;
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
				description: 'Describe which and how many dice to roll, using D&D dice notation. E.g. "d4" or "3d20".',
				type: Constants.ApplicationCommandOptionTypes.STRING,
				required: true
			}
		]
	},
	// Handler for when the command is used
	async execute(interaction, t) {
		const notation = interaction.options.getString('notation');
		const matches = notation.match(notationExpression);

		if (matches === null) {
			await interaction.reply({
				content:
					t.user('reply.invalid-notation') + '\n' + t.user('reply.notation-explanation', { count: MAX_NUMBER_OF_DICE }),
				ephemeral: true
			});
		} else {
			let numberOfDiceString = matches[1];
			if (typeof numberOfDiceString === 'undefined') {
				numberOfDiceString = '1';
			}
			const numberOfDice = parseInt(numberOfDiceString);
			const numberOfFaces = parseInt(matches[3]);
			if (isNaN(numberOfDice) || isNaN(numberOfFaces)) {
				// This should be prevented by the regular expression really...
				await t.privateReply(interaction, 'reply.invalid-number');
			} else if (numberOfDice > MAX_NUMBER_OF_DICE) {
				await t.privateReply(interaction, 'reply.too-many-dice', { count: MAX_NUMBER_OF_DICE });
			} else {
				const result = diceRoll(numberOfDice, numberOfFaces);

				let message =
					t.guild('reply.roll', {
						member: interaction.member.displayName,
						count: numberOfDice,
						numberOfFaces
					}) + '\n';
				if (numberOfDice === 1) {
					message += t.guild('reply.result-single', { result: result[0] });
				} else {
					message += t.guild('reply.result-sum', { results: result.join(t.guild('reply.addition')), sum: sum(result) });
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
