import { ApplicationCommandType, ApplicationCommandOptionType, ChatInputCommandInteraction } from 'discord.js';
import { CommandModule } from '../command-module-types.js';
import { getMemberDisplayName, warningReply } from '../../util/interaction-util.js';

// For now this notation is localised for English and German by allowing "d" and "w" as the dice type prefix.
// More letters can be added for other languages in the future (e.g. "t" for Swedish?).
const NOTATION_EXPRESSION = /^\s*([1-9]\d*)?(d|w)(2|4|6|8|10|12|20)\s*$/i;
const MAX_NUMBER_OF_DICE = 20;

const rollCommand: CommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'roll',
		description: '',
		type: ApplicationCommandType.ChatInput,
		options: [
			{
				name: 'notation',
				description: '',
				type: ApplicationCommandOptionType.String,
				required: true,
				// Given MAX_NUMBER_OF_DICE, the maximum input is "20d20" which has 5 characters.
				max_length: 5
			}
		]
	},
	async execute(interaction, { t }) {
		const notation = interaction.options.getString('notation');
		const matches = notation.match(NOTATION_EXPRESSION);

		if (matches === null) {
			await warningReply(
				interaction,
				t.user('reply.invalid-notation') + '\n' + t.user('reply.notation-explanation', { count: MAX_NUMBER_OF_DICE })
			);
		} else {
			let numberOfDiceString = matches[1];
			if (typeof numberOfDiceString === 'undefined') {
				numberOfDiceString = '1';
			}
			const numberOfDice = parseInt(numberOfDiceString);
			const numberOfFaces = parseInt(matches[3]);
			if (isNaN(numberOfDice) || isNaN(numberOfFaces)) {
				// This should be prevented by the regular expression really...
				await warningReply(interaction, t.user('reply.invalid-number'));
			} else if (numberOfDice > MAX_NUMBER_OF_DICE) {
				await warningReply(interaction, t.user('reply.too-many-dice', { count: MAX_NUMBER_OF_DICE }));
			} else {
				const result = diceRoll(numberOfDice, numberOfFaces);

				let message =
					t.guild('reply.roll', {
						member: getMemberDisplayName(interaction),
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

function diceRoll(numberOfDice: number, numberOfFaces: number): number[] {
	const result = [];
	for (let i = 0; i < numberOfDice; i++) {
		result.push(Math.floor(Math.random() * numberOfFaces) + 1);
	}
	return result;
}

function sum(diceRollResult: number[]) {
	let result = 0;
	for (let i = 0; i < diceRollResult.length; i++) {
		result += diceRollResult[i];
	}
	return result;
}

export default rollCommand;
