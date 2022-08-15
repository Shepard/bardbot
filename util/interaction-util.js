import { MessageEmbed } from 'discord.js';
import { EMBED_DESCRIPTION_CHARACTER_LIMIT, EMBEDS_PER_MESSAGE_LIMIT } from './discord-constants.js';
import { chunk, codePointLength } from './helpers.js';

export async function privateReply(t, interaction, messageKey, options) {
	await interaction.reply({
		content: t(messageKey, options),
		ephemeral: true
	});
}

export function getCustomIdForCommandRouting(command, innerId) {
	return '/' + command.configuration.name + '#' + innerId;
}

export async function sendListReply(interaction, listItems, title, suppressMentions, ephemeral, wasDeferred) {
	let messageText = '';
	const messageTexts = [];
	listItems.forEach(listItem => {
		// If messageText would exceed the character limit of embed descriptions by appending this line, split it off into a separate messageText.
		if (codePointLength(messageText + listItem + '\n') > EMBED_DESCRIPTION_CHARACTER_LIMIT) {
			messageTexts.push(messageText);
			messageText = listItem;
		} else {
			if (messageText) {
				messageText += '\n';
			}
			messageText += listItem;
		}
	});
	messageTexts.push(messageText);

	// Send list as messages with embeds. The initial message contains a title and the first batch of items.

	const embeds = messageTexts.map(text => new MessageEmbed().setDescription(text));
	if (title) {
		embeds[0].setTitle(title);
	}

	// We can send up to EMBEDS_PER_MESSAGE_LIMIT embeds per message.
	const embedChunks = chunk(embeds, EMBEDS_PER_MESSAGE_LIMIT);

	const messages = embedChunks.map(embedChunk => {
		const message = { embeds: embedChunk };
		if (suppressMentions) {
			message.allowed_mentions = {
				parse: []
			};
		}
		if (ephemeral) {
			message.ephemeral = ephemeral;
		}
		return message;
	});

	if (wasDeferred) {
		await interaction.editReply(messages[0]);
	} else {
		await interaction.reply(messages[0]);
	}

	// If there are more messages needed, send them as follow-ups.
	for (let i = 1; i < messages.length; i++) {
		await interaction.followUp(messages[i]);
	}
}
