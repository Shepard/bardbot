import { Constants, MessageEmbed } from 'discord.js';
import {
	EMBED_DESCRIPTION_CHARACTER_LIMIT,
	EMBEDS_PER_MESSAGE_LIMIT,
	COLOUR_DISCORD_RED,
	COLOUR_DISCORD_YELLOW
} from './discord-constants.js';
import { chunk, codePointLength } from './helpers.js';

export async function privateReply(t, interaction, messageKey, options) {
	await sendPrivateReply(interaction, { content: t(messageKey, options) });
}

export async function errorReply(interaction, text, components, forceEphemeral) {
	await borderedReply(interaction, text, components, forceEphemeral, COLOUR_DISCORD_RED);
}

export async function warningReply(interaction, text, components, forceEphemeral) {
	await borderedReply(interaction, text, components, forceEphemeral, COLOUR_DISCORD_YELLOW);
}

async function borderedReply(interaction, text, components, forceEphemeral, colour) {
	const message = {
		embeds: [new MessageEmbed().setDescription(text).setColor(colour)]
	};
	if (components) {
		message.components = components;
	}
	await sendPrivateReply(interaction, message, forceEphemeral);
}

export async function sendPrivateReply(interaction, message, forceEphemeral) {
	message.ephemeral = true;
	if (interaction.replied) {
		await interaction.followUp(message);
	} else {
		if (interaction.deferred) {
			if (forceEphemeral) {
				// In this case we can't guarantee that the original .deferReply() call was ephemeral
				// and we can't edit it to be ephemeral after the fact either.
				// So we delete the initial deferred reply and have to use a follow-up in order to send an ephemeral message.
				try {
					await interaction.deleteReply();
				} catch (e) {
					// This will throw if the reply already was ephemeral because we can't delete ephemeral messages. Just ignore.
				}
				await interaction.followUp(message);
			} else {
				await interaction.editReply(message);
			}
		} else {
			await interaction.reply(message);
		}
	}
}

export function getCustomIdForCommandRouting(command, innerId) {
	return '/' + command.configuration.name + '#' + innerId;
}

export async function sendListReply(interaction, listItems, title, suppressMentions, ephemeral) {
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

	// TODO This is flawed. according to https://discord.com/developers/docs/resources/channel#embed-object-embed-limits we can send 6000 characters across *all* embeds, not per embed.
	//  So with a description character limit of 4096 characters we can't send more than one embed per message.
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

	if (interaction.deferred || interaction.replied) {
		await interaction.editReply(messages[0]);
	} else {
		await interaction.reply(messages[0]);
	}

	// If there are more messages needed, send them as follow-ups.
	for (let i = 1; i < messages.length; i++) {
		await interaction.followUp(messages[i]);
	}
}

export async function markSelectedButton(interaction) {
	const selected = interaction.customId;
	await changeButtons(interaction, button => {
		button.disabled = true;
		if (button.customId === selected) {
			button.emoji = {
				id: null,
				name: '✅'
			};
		}
	});
}

export async function resetSelectionButtons(interaction) {
	await changeButtons(interaction, button => {
		button.disabled = false;
		delete button.emoji;
	});
}

export async function disableButtons(interaction) {
	await changeButtons(interaction, button => {
		button.disabled = true;
	});
}

async function changeButtons(interaction, buttonModifier, message) {
	const components = interaction.message.components.map(component => changeButtonsInner(component, buttonModifier));
	message = { ...message, components };
	if (interaction.deferred || interaction.replied) {
		await interaction.editReply(message);
	} else {
		await interaction.update(message);
	}
}

function changeButtonsInner(component, buttonModifier) {
	const result = { ...component };
	if (result.type === Constants.MessageComponentTypes[Constants.MessageComponentTypes.ACTION_ROW]) {
		result.components = result.components.map(component => changeButtonsInner(component, buttonModifier));
	} else if (result.type === Constants.MessageComponentTypes[Constants.MessageComponentTypes.BUTTON]) {
		buttonModifier(result);
	}
	return result;
}
