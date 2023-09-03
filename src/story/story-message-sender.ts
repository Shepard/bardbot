import {
	ButtonStyle,
	ComponentType,
	EmbedBuilder,
	EmbedAuthorOptions,
	ChatInputCommandInteraction,
	MessageComponentInteraction,
	MessageCreateOptions,
	ButtonBuilder,
	ModalSubmitInteraction
} from 'discord.js';
import { Choice } from '@shepard4711/inkjs/engine/Choice.js';
import {
	ChoiceButtonStyle,
	EnhancedStepData,
	StoryCharacter,
	StoryLine,
	CharacterImageSize,
	ChoiceAction,
	isInputChoiceAction,
	StoryMetadata
} from './story-types.js';
import { parseLineSpeech, parseChoiceButtonStyle, parseChoiceAction } from './story-information-extractor.js';
import { ContextTranslatorFunctions, InteractionButtonStyle } from '../util/interaction-types.js';
import { codePointLength, trimText, chunk, splitTextAtWhitespace, wait } from '../util/helpers.js';
import {
	MESSAGE_CONTENT_CHARACTER_LIMIT,
	EMBED_DESCRIPTION_CHARACTER_LIMIT,
	BUTTON_LABEL_CHARACTER_LIMIT,
	MESSAGE_ACTION_ROW_LIMIT,
	ACTION_ROW_BUTTON_LIMIT
} from '../util/discord-constants.js';
import { SuggestionData } from '../storage/record-types.js';
import RandomMessageProvider from '../util/random-message-provider.js';

/**
 * Delay in milli seconds before posting the next message when encountering a PAUSE tag.
 */
const MESSAGE_DELAY = 3000;

/**
 * Some message objects generated by getMessagesToSend() are not text messages to be sent to Discord
 * but instructions to sendStoryStepData to do something else instead.
 */
enum SpecialHandling {
	Delay = 'Delay'
}

type SpecialHandlingMessage = {
	specialHandling: SpecialHandling;
};

type StoryMessage = MessageCreateOptions | SpecialHandlingMessage;

function isSpecialHandlingMessage(message: StoryMessage): message is SpecialHandlingMessage {
	return (message as SpecialHandlingMessage).specialHandling !== undefined;
}

interface ButtonChoice {
	text: string;
	index: number;
	tags: string[] | null;
	style: InteractionButtonStyle;
	action: ChoiceAction;
}

const endMessages = new RandomMessageProvider()
	.add(t => t('reply.story-outro1'))
	.add(t => t('reply.story-outro2'))
	.add(t => t('reply.story-outro3'))
	.add(t => t('reply.story-outro4'))
	.add(t => t('reply.story-outro5'));

export const suggestionMessages = new RandomMessageProvider()
	.add(t => t('reply.suggestion1'))
	.add(t => t('reply.suggestion2'))
	.add(t => t('reply.suggestion3'))
	.add(t => t('reply.suggestion4'))
	.add(t => t('reply.suggestion5'));

/**
 * Takes stepData representing the lines, choices and other info for one step of the story,
 * and sends them as messages to the DMs of the user who triggered the interaction.
 * @param interaction The interaction triggered by the user to start or continue in the story.
 * @param stepData The data of the current step of the story, to be turned into messages and sent out.
 * @param t A translator.
 * @param getStoryButtonId A function for getting a custom id for a button that routes back to the story command.
 */
export async function sendStoryStepData(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction,
	stepData: EnhancedStepData,
	t: ContextTranslatorFunctions,
	getChoiceButtonId: (choiceIndex: number) => string,
	getInputButtonId: (choiceIndex: number) => string,
	getStartButtonId: (storyId: string) => string,
	getStoryEmbed: (metadata: StoryMetadata) => EmbedBuilder
) {
	const messages = getMessagesToSend(stepData, t, getChoiceButtonId, getInputButtonId, getStartButtonId, getStoryEmbed);
	const dmChannel = await interaction.user.createDM();
	for (const message of messages) {
		if (isSpecialHandlingMessage(message)) {
			if (message.specialHandling === SpecialHandling.Delay) {
				await dmChannel.sendTyping();
				await wait(MESSAGE_DELAY);
			}
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
export function getMessagesToSend(
	stepData: EnhancedStepData,
	t: ContextTranslatorFunctions,
	getChoiceButtonId: (choiceIndex: number) => string,
	getInputButtonId: (choiceIndex: number) => string,
	getStartButtonId: (storyId: string) => string,
	getStoryEmbed: (metadata: StoryMetadata) => EmbedBuilder
) {
	const messages: StoryMessage[] = [];

	if (stepData.lines.length > 0) {
		appendTextMessages(messages, stepData.lines, stepData.characters);
	}

	if (stepData.choices.length > 0) {
		appendChoiceButtons(
			messages,
			stepData.choices,
			t,
			getChoiceButtonId,
			getInputButtonId,
			stepData.defaultButtonStyle
		);
	}

	if (stepData.isEnd) {
		appendEndMessage(messages, t, getStartButtonId(stepData.storyRecord.id));

		if (stepData.suggestions?.length) {
			appendStorySuggestions(messages, stepData.suggestions, t, getStoryEmbed, getStartButtonId);
		}
	}

	return messages;
}

/**
 * Creates messages for the text lines of the story.
 * Tries to combine lines into single messages as much as possible so we don't send too many messages out.
 * Messages marked up with tags might result in separate, marked up, messages.
 */
function appendTextMessages(messages: StoryMessage[], lines: StoryLine[], characters: Map<string, StoryCharacter>) {
	let messageText = '';
	let previousCharacter: StoryCharacter | null = null;
	let previousCharacterImageSize: CharacterImageSize = 'small';
	let previousLineWasStandalone = false;

	// Append stored messageText as message before starting a new message with the current line.
	function flushMessageText() {
		// Discord will reject empty messages so we need to check if there's any text before creating a message.
		if (messageText.trim().length > 0) {
			appendMessage(messageText, previousCharacter, previousCharacterImageSize);
			messageText = '';
		}
	}

	function appendMessage(text: string, character: StoryCharacter | null, characterImageSize: CharacterImageSize) {
		if (character) {
			messages.push(getCharacterMessage(text, character, characterImageSize));
		} else {
			messages.push({ content: text });
		}
	}

	lines.forEach(line => {
		let lineText = line.text;
		let lineCharacter: StoryCharacter | null = null;
		let lineCharacterImageSize: CharacterImageSize = 'small';
		let messageLimit = MESSAGE_CONTENT_CHARACTER_LIMIT;

		const lineSpeech = parseLineSpeech(line, characters);
		if (lineSpeech) {
			lineText = lineSpeech.text;
			messageLimit = EMBED_DESCRIPTION_CHARACTER_LIMIT;
			lineCharacter = lineSpeech.character;
			lineCharacterImageSize = lineSpeech.characterImageSize;
		}

		if (lineCharacter !== previousCharacter || lineCharacterImageSize !== previousCharacterImageSize) {
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
				appendMessage(texts[i], lineCharacter, lineCharacterImageSize);
			}
			messageText = texts[texts.length - 1];
		} else if (codePointLength(messageText + '\n' + lineText) > messageLimit) {
			// messageText would exceed the character limit of a message by appending this line, so split it off into a separate messageText.

			if (messageText.trim().length > 0) {
				appendMessage(messageText, lineCharacter, lineCharacterImageSize);
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
		previousCharacterImageSize = lineCharacterImageSize;
	});

	// If we still have some text left over at the end, append it as another message.
	flushMessageText();
}

function getCharacterMessage(
	messageText: string,
	character: StoryCharacter,
	characterImageSize: CharacterImageSize
): MessageCreateOptions {
	const characterEmbed = new EmbedBuilder().setDescription(messageText);
	const author: EmbedAuthorOptions = { name: character.name };
	if (character.imageUrl) {
		switch (characterImageSize) {
			case 'small':
				author.iconURL = character.imageUrl;
				characterEmbed.setAuthor(author);
				break;
			case 'medium':
				characterEmbed.setTitle(character.name).setThumbnail(character.imageUrl);
				break;
			case 'large':
				characterEmbed.setTitle(character.name).setImage(character.imageUrl);
				break;
		}
	} else {
		characterEmbed.setAuthor(author);
	}
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
function appendChoiceButtons(
	messages: StoryMessage[],
	choices: Choice[],
	t: ContextTranslatorFunctions,
	getChoiceButtonId: (choiceIndex: number) => string,
	getInputButtonId: (choiceIndex: number) => string,
	defaultButtonStyleRaw: ChoiceButtonStyle
) {
	// Create the message to append the buttons to.
	let buttonMessage: MessageCreateOptions;

	// If any of the choices are too long to fit into a button label,
	// list all the choices with their numbers before the buttons to provide the full text
	// and add those numbers to the buttons too, abbreviating their labels to the character limit.
	const choiceTooLong: Choice | null = choices.find(
		choice => codePointLength(choice.text) > BUTTON_LABEL_CHARACTER_LIMIT
	);
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
		buttonMessage = {};
		messages.push(buttonMessage);
	}

	// Create buttons and append them to the message.
	let defaultButtonStyle = mapButtonStyle(defaultButtonStyleRaw, ButtonStyle.Secondary);
	const parsedChoices = parseChoiceButtonInformation(choices, defaultButtonStyle);
	let buttons = parsedChoices.map(choice =>
		getChoiceButton(t, choice, choiceTooLong, getChoiceButtonId, getInputButtonId)
	);
	buttonMessage.components = [
		{
			type: ComponentType.ActionRow,
			components: buttons
		}
	];
	if (buttons.length > ACTION_ROW_BUTTON_LIMIT) {
		// There's more choice buttons than Discord allows per action row,
		// so we have to split them up into several action rows.
		const buttonsChunked = chunk(buttons, ACTION_ROW_BUTTON_LIMIT);
		buttonMessage.components = buttonsChunked.map(chunk => ({
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
 * Checks for some special tags on the choices (or for some special syntax in the text of choices [legacy])
 * to determine if this choice should be represented by a specific button style and if it should perform a specific action.
 * Will strip that syntax from the choice text if necessary and enhance the choices with various information.
 * E.g. a choice text of "style-secondary:regular choice text" will result in the button style "secondary" and the choice text "regular choice text".
 * A choice with tag "button-style: primary" will result in the button style "primary" and the choice text will be left alone.
 * Available styles are: primary, secondary, success, danger.
 * @param choices An array of Ink choice objects.
 * @param defaultButtonStyle The button style to fall back on if none is found in a choice label.
 * @returns An array of new choice objects with potentially modified text properties and new style and action properties.
 */
function parseChoiceButtonInformation(choices: Choice[], defaultButtonStyle: InteractionButtonStyle): ButtonChoice[] {
	return choices.map(choice => {
		let text = choice.text;
		let style = defaultButtonStyle;

		const styleFromTags = parseChoiceButtonStyle(choice);
		if (styleFromTags) {
			style = mapButtonStyle(styleFromTags, style);
		} else {
			const separatorIndex = text.indexOf(':');
			if (text.toLowerCase().startsWith('style-') && separatorIndex > 0) {
				// Legacy syntax: choice text prefix
				const styleRaw = text.substring('style-'.length, separatorIndex).toLowerCase();
				style = mapButtonStyle(styleRaw, style);
				text = text.substring(separatorIndex + 1);
			}
		}

		const action = parseChoiceAction(choice);

		return { ...choice, text, style, action };
	});
}

function mapButtonStyle(styleRaw: string, defaultStyle: InteractionButtonStyle) {
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

/**
 * @returns A Discord button object representing this choice.
 */
function getChoiceButton(
	t: ContextTranslatorFunctions,
	choice: ButtonChoice,
	choicesTooLong: Choice | null,
	getChoiceButtonId: (choiceIndex: number) => string,
	getInputButtonId: (choiceIndex: number) => string
) {
	let label = choice.text;
	if (choicesTooLong) {
		label = trimText(
			t.user('choice-button-indexed-label', { choiceIndex: choice.index + 1, choiceText: choice.text }),
			BUTTON_LABEL_CHARACTER_LIMIT
		);
	}

	let actionId: string;
	if (isInputChoiceAction(choice.action)) {
		actionId = getInputButtonId(choice.index);
	} else {
		actionId = getChoiceButtonId(choice.index);
	}

	return new ButtonBuilder({
		type: ComponentType.Button,
		style: choice.style,
		label,
		custom_id: actionId
	});
}

function appendEndMessage(messages: StoryMessage[], t: ContextTranslatorFunctions, startButtonId: string) {
	const endEmbed = new EmbedBuilder().setDescription(endMessages.any(t.user));
	const replayButton = new ButtonBuilder({
		type: ComponentType.Button,
		style: ButtonStyle.Secondary,
		label: t.user('replay-button-label'),
		custom_id: startButtonId
	});
	messages.push({
		embeds: [endEmbed],
		components: [
			{
				type: ComponentType.ActionRow,
				components: [replayButton]
			}
		]
	});
}

function appendStorySuggestions(
	messages: StoryMessage[],
	suggestions: SuggestionData[],
	t: ContextTranslatorFunctions,
	getStoryEmbed: (metadata: StoryMetadata) => EmbedBuilder,
	getStartButtonId: (storyId: string) => string
) {
	suggestions.forEach(suggestion => {
		const suggestionMessage = suggestion.message ? suggestion.message : suggestionMessages.any(t.user);
		const messageEmbed = new EmbedBuilder().setDescription(suggestionMessage);
		const startButton = new ButtonBuilder({
			type: ComponentType.Button,
			style: ButtonStyle.Secondary,
			label: t.user('start-button-label'),
			custom_id: getStartButtonId(suggestion.suggestedStory.id)
		});
		messages.push({
			embeds: [messageEmbed, getStoryEmbed(suggestion.suggestedStory)],
			components: [
				{
					type: ComponentType.ActionRow,
					components: [startButton]
				}
			]
		});
	});
}
