import { ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { codePointLength, trimText, chunk, splitTextAtWhitespace, wait } from '../util/helpers.js';
import {
	MESSAGE_CONTENT_CHARACTER_LIMIT,
	EMBED_DESCRIPTION_CHARACTER_LIMIT,
	BUTTON_LABEL_CHARACTER_LIMIT,
	MESSAGE_ACTION_ROW_LIMIT,
	ACTION_ROW_BUTTON_LIMIT
} from '../util/discord-constants.js';

/**
 * Delay in milli seconds before posting the next message when encountering a PAUSE tag.
 */
const MESSAGE_DELAY = 3000;

/**
 * Some message objects generated by getMessagesToSend() are not text messages to be sent to Discord
 * but instructions to sendStoryStepData to do something else instead.
 */
const SpecialHandling = Object.freeze({
	Delay: 'Delay'
});

/**
 * Takes stepData representing the lines, choices and other info for one step of the story,
 * and sends them as messages to the DMs of the user who triggered the interaction.
 * @param interaction The interaction triggered by the user to start or continue in the story.
 * @param stepData The data of the current step of the story, to be turned into messages and sent out.
 * @param t A translator.
 * @param getStoryButtonId A function for getting a custom id for a button that routes back to the story command.
 */
export async function sendStoryStepData(interaction, stepData, t, getStoryButtonId, startButtonId) {
	const messages = getMessagesToSend(stepData, t, getStoryButtonId, startButtonId);
	const dmChannel = await interaction.user.createDM();
	for (const message of messages) {
		if (message.specialHandling === SpecialHandling.Delay) {
			await dmChannel.sendTyping();
			await wait(MESSAGE_DELAY);
		} else {
			await dmChannel.send(message);
		}
	}
}

/**
 * Takes the provided stepData and turns it into messages with choice buttons appended, ready to be sent out to Discord.
 * Some of the messages do not represent messages to be sent directly to Discord but rather instructions for special handling in sendStoryStepData.
 *
 * This is only exported to make it easier to unit test. It is not meant to be used outside of this module otherwise.
 */
export function getMessagesToSend(stepData, t, getStoryButtonId, startButtonId) {
	const messages = [];

	if (stepData.lines.length > 0) {
		appendTextMessages(messages, stepData.lines, stepData.characters);
	}

	if (stepData.choices.length > 0) {
		appendChoiceButtons(messages, stepData.choices, t, getStoryButtonId, stepData.defaultButtonStyle);
	}

	if (stepData.isEnd) {
		appendEndMessage(messages, t, startButtonId);
	}

	return messages;
}

/**
 * Creates messages for the text lines of the story.
 * Tries to combine lines into single messages as much as possible so we don't send too many messages out.
 * Messages marked up with tags might result in separate, marked up, messages.
 */
function appendTextMessages(messages, lines, characters) {
	let messageText = '';
	let previousCharacter = null;
	let previousLineWasStandalone = false;

	// Append stored messageText as message before starting a new message with the current line.
	function flushMessageText() {
		// Discord will reject empty messages so we need to check if there's any text before creating a message.
		if (messageText.trim().length > 0) {
			appendMessage(messageText, previousCharacter);
			messageText = '';
		}
	}

	function appendMessage(text, character) {
		if (character) {
			messages.push(getCharacterMessage(text, character));
		} else {
			messages.push({ content: text });
		}
	}

	lines.forEach(line => {
		let lineText = line.text;
		let lineCharacter = null;
		let messageLimit = MESSAGE_CONTENT_CHARACTER_LIMIT;
		const separatorIndex = lineText.indexOf(':');
		if (separatorIndex > 0) {
			const characterName = lineText.substring(0, separatorIndex).trim();
			lineCharacter = characters.get(characterName);
			if (lineCharacter) {
				lineText = lineText.substring(separatorIndex + 1).trim();
				messageLimit = EMBED_DESCRIPTION_CHARACTER_LIMIT;
			}
		}

		if (lineCharacter !== previousCharacter) {
			flushMessageText();
		}

		if (line.tags.find(tag => tag.toLowerCase() === 'pause')) {
			flushMessageText();
			messages.push({ specialHandling: SpecialHandling.Delay });
		}

		if (previousLineWasStandalone) {
			flushMessageText();
			previousLineWasStandalone = false;
		}

		// Lines including URLs are automatically set to standalone. This makes sure that images Discord detects from URLs in text are not shown
		// at the very bottom of a long block of automatically combined lines of text, but where the author intended them to show up,
		// without requiring the author to mark up every image URL with the STANDALONE tag.
		// The URL detection is obviously very rough, but it doesn't need to be perfect. It just needs to catch most of the cases.
		// For all others, the author can help out by using a STANDALONE tag or by living with the fact, that a line wasn't bundled up with others.
		// (Which is not something authors should care about anyway, it's just an optimisation to send messages out faster.)
		if (
			lineText.includes('http://') ||
			lineText.includes('https://') ||
			line.tags.find(tag => tag.toLowerCase() === 'standalone')
		) {
			flushMessageText();
			previousLineWasStandalone = true;
		}

		// TODO later: tags for showing scenes as embeds, with title, description, colour, image?
		//  maybe it consists of multiple lines, each containing title, description, field label and values etc.
		//  that way we can use ink means to make them different each time, e.g. with queries or variables.
		//  the first line contains tags for colour, image.
		//  would be nice if the image could differ based on variables as well. would have to parse it from the content instead of tags probably. maybe.
		//  adjust messageLimit to EMBED_DESCRIPTION_CHARACTER_LIMIT for this as well.

		if (codePointLength(lineText) > messageLimit) {
			// The current line exceeds the character limit of a message, so we need to split it up, preferrably at whitespace.

			// Discord will reject empty messages so we need to check if there's any text before creating a message.
			if (messageText.trim().length > 0) {
				messages.push({ content: messageText });
			}

			const texts = splitTextAtWhitespace(lineText, messageLimit);
			for (let i = 0; i < texts.length - 1; i++) {
				appendMessage(texts[i], lineCharacter);
			}
			messageText = texts[texts.length - 1];
		} else if (codePointLength(messageText + '\n' + lineText) > messageLimit) {
			// messageText would exceed the character limit of a message by appending this line, so split it off into a separate messageText.

			if (messageText.trim().length > 0) {
				appendMessage(messageText, lineCharacter);
			}
			messageText = lineText;
		} else {
			// line still fits into this message, so append it (with a line-break inbetween if necessary).
			if (messageText && !messageText.endsWith('\n')) {
				messageText += '\n';
			}
			// Note that this might append a line with no text in it. Which is fine, we can have some empty lines printed out,
			// as long as the message contains *some* content in the end.
			messageText += lineText;
		}

		previousCharacter = lineCharacter;
	});

	// If we still have some text left over at the end, append it as another message.
	flushMessageText();
}

function getCharacterMessage(messageText, character) {
	const characterEmbed = new EmbedBuilder().setDescription(messageText);
	const author = { name: character.name };
	if (character.iconUrl) {
		author.iconURL = character.iconUrl;
	}
	characterEmbed.setAuthor(author);
	if (character.colour) {
		characterEmbed.setColor(character.colour);
	}

	// TODO later: messages can contain multiple embeds -> combine embeds from different character speeches into single messages as much as possible.
	//  wrapped embeds from one character cannot be combined as the description goes up to 4096 characters, but across all embeds we can only have 6000 characters.
	//  we could even combine character embeds with messages for regular lines coming right before the character lines.
	return {
		embeds: [characterEmbed]
	};
}

/**
 * Creates buttons for the choices available to the user and appends them to the messages.
 */
function appendChoiceButtons(messages, choices, t, getStoryButtonId, defaultButtonStyleRaw) {
	// This is the message we append the buttons to.
	// Since every message needs some content, we can't send a message with only buttons.
	// So we first need to determine/create that message.
	// This necessity might change in the future: https://gist.github.com/NovaFox161/b69bdc908f0d95085ae94353d8db460a
	// > Components will be able to be sent without message content/embed. even tho mason strongly objects, it looks like they're going to do it.
	let buttonMessage;

	let defaultButtonStyle = mapButtonStyle(defaultButtonStyleRaw, ButtonStyle.Secondary);
	choices = parseChoiceButtonStyles(choices, defaultButtonStyle);

	// If any of the choices are too long to fit into a button label,
	// list all the choices with their numbers before the buttons to provide the full text
	// and add those numbers to the buttons too, abbreviating their labels to the character limit.
	const choiceTooLong = choices.find(choice => codePointLength(choice.text) > BUTTON_LABEL_CHARACTER_LIMIT);
	if (choiceTooLong) {
		let messageContent = choices
			.map(choice => t.user('choice-button-indexed-label', { choiceIndex: choice.index + 1, choiceText: choice.text }))
			.join('\n');

		if (codePointLength(messageContent) > MESSAGE_CONTENT_CHARACTER_LIMIT) {
			const texts = splitTextAtWhitespace(messageContent, MESSAGE_CONTENT_CHARACTER_LIMIT);
			for (let i = 0; i < texts.length - 1; i++) {
				messages.push({ content: texts[i] });
			}
			messageContent = texts[texts.length - 1];
		}

		buttonMessage = { content: messageContent };
		messages.push(buttonMessage);
	} else {
		// For the choice message we either use the last regular line that happened before the choices,
		// or a fixed message if there was no regular line before it.
		if (messages.length) {
			buttonMessage = findLastRegularMessage(messages);
		}
		if (!buttonMessage) {
			buttonMessage = { content: t.user('choice-buttons-header') };
			messages.push(buttonMessage);
		}
	}

	// Create buttons and append them to the message.
	let buttons = choices.map(choice => getChoiceButton(t, choice, choiceTooLong, getStoryButtonId));
	buttonMessage.components = [
		{
			type: ComponentType.ActionRow,
			components: buttons
		}
	];
	if (buttons.length > ACTION_ROW_BUTTON_LIMIT) {
		// There's more choice buttons than Discord allows per action row,
		// so we have to split them up into several action rows.
		buttons = chunk(buttons, ACTION_ROW_BUTTON_LIMIT);
		buttonMessage.components = buttons.map(chunk => ({
			type: ComponentType.ActionRow,
			components: chunk
		}));
		if (buttonMessage.components.length > MESSAGE_ACTION_ROW_LIMIT) {
			// There's so many choice buttons that they even create more action rows than Discord allows!
			// We could send them in multiple messages but that is problematic for disabling them.
			// So we just cut them off and tell the user in a warning.
			// The story author will have been warned by the engine already.
			buttonMessage.components = buttonMessage.components.slice(0, MESSAGE_ACTION_ROW_LIMIT);
			messages.push({
				content: t.user('reply.too-many-choices', { choiceLimit: ACTION_ROW_BUTTON_LIMIT * MESSAGE_ACTION_ROW_LIMIT })
			});
		}
	}
}

/**
 * Checks for some special syntax in the text of choices to determine if this choice should be represented by a specific button style.
 * Will strip that syntax from the choice text and enhance the choices with style information.
 * E.g. a choice text of "style-secondary:regular choice text" will result in the button style "secondary" and the choice text "regular choice text".
 * Available styles are: primary, secondary, success, danger.
 * @param choices An array of Ink choice objects.
 * @param defaultButtonStyle The button style to fall back on if none is found in a choice label.
 * @returns An array of new choice objects with potentially modified text properties and new style properties.
 */
function parseChoiceButtonStyles(choices, defaultButtonStyle) {
	return choices.map(choice => {
		let text = choice.text;
		let style = defaultButtonStyle;
		const separatorIndex = text.indexOf(':');
		if (text.toLowerCase().startsWith('style-') && separatorIndex > 0) {
			const styleRaw = text.substring('style-'.length, separatorIndex).toLowerCase();
			style = mapButtonStyle(styleRaw, style);
			text = text.substring(separatorIndex + 1);
		}
		return { ...choice, text, style };
	});
}

function mapButtonStyle(styleRaw, defaultStyle) {
	switch (styleRaw) {
		case 'primary':
			return ButtonStyle.Primary;
		case 'secondary':
			return ButtonStyle.Secondary;
		case 'success':
			return ButtonStyle.Success;
		case 'danger':
			return ButtonStyle.Danger;
	}
	return defaultStyle;
}

function findLastRegularMessage(messages) {
	if (!messages[messages.length - 1].specialHandling) {
		return messages[messages.length - 1];
	}
	return null;
}

/**
 * @returns A Discord button object representing this choice.
 */
function getChoiceButton(t, choice, choicesTooLong, getStoryButtonId) {
	let label = choice.text;
	if (choicesTooLong) {
		label = trimText(
			t.user('choice-button-indexed-label', { choiceIndex: choice.index + 1, choiceText: choice.text }),
			BUTTON_LABEL_CHARACTER_LIMIT
		);
	}
	return {
		type: ComponentType.Button,
		style: choice.style,
		label,
		custom_id: getStoryButtonId('choice ' + choice.index)
	};
}

function appendEndMessage(messages, t, startButtonId) {
	const endEmbed = new EmbedBuilder().setDescription(t.user('reply.story-outro'));
	const replayButton = {
		type: ComponentType.Button,
		style: ButtonStyle.Secondary,
		label: t.user('replay-button-label'),
		custom_id: startButtonId
	};
	messages.push({
		embeds: [endEmbed],
		components: [
			{
				type: ComponentType.ActionRow,
				components: [replayButton]
			}
		]
	});
	// TODO later: story-engine could attach more properties describing the state at the end. was it a good or bad end? are there more ends? any unlocks?
	//  "By playing through this story, you've unlocked story XYZ."
}
