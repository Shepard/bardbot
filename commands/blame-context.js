import { userMention } from '@discordjs/builders';
import { Constants } from 'discord.js';
import { getMessageMetadata } from '../storage/message-metadata-dao.js';
import RandomMessageProvider from '../random-message-provider.js';

export const blameMessages = new RandomMessageProvider()
	.add(user => `${userMention(user)} told me to do it!`)
	.add(user => `${userMention(user)} made me do it!`)
	.add(user => `I blame ${userMention(user)}...`)
	.add(user => `Ask ${userMention(user)}, not me!`)
	.add(user => `${userMention(user)} looks awfully suspicious over there...`)
	.add(user => `Couldn't be ${userMention(user)}, could it?`);

const blameContextCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'Who dunnit?',
		type: Constants.ApplicationCommandTypes.MESSAGE
	},
	// Handler for when the command is used
	async execute(interaction) {
		// Get message that the context menu command was used on.
		const message = interaction.options.getMessage('message');
		if (message) {
			if (message.interaction) {
				// While this might seem superfluous because the user of an interaction reply is clearly shown in Discord,
				// it would be even weirder for the bot to go "I don't know.". So it's just for the sake of completeness.
				await replyWithUser(interaction, message.interaction.user.id);
			} else {
				const metadata = getMessageMetadata(message.id);
				if (metadata) {
					await replyWithUser(interaction, metadata.interactingUserId);
				} else {
					await interaction.reply({
						content: "Sorry, I don't remember.",
						ephemeral: true
					});
				}
			}
		} else {
			await interaction.reply({ content: 'Could not find message to execute command on.', ephemeral: true });
		}
	}
};

async function replyWithUser(interaction, userId) {
	await interaction.reply({
		content: blameMessages.any(userId),
		ephemeral: true
	});
}

export default blameContextCommand;
