import { Constants } from 'discord.js';
import logger from '../util/logger.js';
import { translate, translationExists, SUPPORTED_LANGUAGES } from '../util/i18n.js';
import {
	COMMAND_NAME_CHARACTER_LIMIT,
	COMMAND_DESCRIPTION_CHARACTER_LIMIT,
	COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT,
	COMMAND_NAME_REGEXP
} from '../util/discord-constants.js';

export function addCommandTranslations(command) {
	const commandPrefix =
		'commands.' + (command.commandNameKeyPrefixOverride ?? command.i18nKeyPrefix ?? command.configuration.name);
	traverseCommandStructure(command.configuration, commandPrefix, false);
}

function traverseCommandStructure(object, keyPrefix, isOption) {
	addNameAndDescriptionTranslations(object, keyPrefix, isOption);

	if (object.options) {
		const optionsKeyPrefix = keyPrefix + '.options';
		object.options.forEach(option => {
			if (option.name) {
				const optionKeyPrefix = optionsKeyPrefix + '.' + option.name;
				traverseCommandStructure(option, optionKeyPrefix, true);
			}
		});
	}

	if (object.choices) {
		const choicesKeyPrefix = keyPrefix + '.choices';
		object.choices.forEach(choice => {
			if (choice.name) {
				const choiceKeyPrefix = choicesKeyPrefix + '.' + choice.name;
				const choiceNameValidator = lengthValidator.bind(null, 1, COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT);
				const nameTranslations = getAllTranslations(choiceKeyPrefix, choiceNameValidator);
				if (Object.keys(nameTranslations).length) {
					choice.nameLocalizations = nameTranslations;
				}
			}
		});
	}
}

function addNameAndDescriptionTranslations(object, keyPrefix, isOption) {
	const isOptionOrChatInputCommand = isOption || object.type === Constants.ApplicationCommandTypes.CHAT_INPUT;

	// TODO Name localisations of slash command names are disabled until a show-stopper bug in the feature is fixed:
	//  https://github.com/discord/discord-api-docs/issues/5001
	//  When activating this for slash commands, make sure to adjust the mentions of slash commands in translations.
	if (isOption || object.type !== Constants.ApplicationCommandTypes.CHAT_INPUT) {
		const nameValidator = commandNameValidator.bind(null, isOptionOrChatInputCommand);
		const nameTranslations = getAllTranslations(keyPrefix + '.name', nameValidator);
		if (Object.keys(nameTranslations).length) {
			object.nameLocalizations = nameTranslations;
		}
	}

	// Only add descriptions if this is an option or a chat input command.
	// We can't have descriptions on user or message commands.
	if (isOptionOrChatInputCommand) {
		const descriptionKey = keyPrefix + '.description';
		if (translationExists(descriptionKey, { lng: 'en' })) {
			const descriptionValidator = lengthValidator.bind(null, 1, COMMAND_DESCRIPTION_CHARACTER_LIMIT);

			// For the description we not only add translations in other languages but even initialise the default description property from the English translation.
			// This way we can leave them out of the command configuration code and don't duplicate them (which would lead to the texts diverging).
			// We only do this for the description and not the name because:
			// - We need the name to exist in the command configuration in the first place in order to form the key to find the translations.
			// - The name is used as an identifier and referred to in code. So we don't want the English translation file to be able to override the name property.
			const defaultDescription = descriptionValidator(translate(descriptionKey, { lng: 'en' }));
			if (defaultDescription) {
				object.description = defaultDescription;
			}

			const descriptionTranslations = getAllTranslations(descriptionKey, descriptionValidator);
			if (Object.keys(descriptionTranslations).length) {
				object.descriptionLocalizations = descriptionTranslations;
			}
		}
	}
}

function getAllTranslations(key, validator) {
	const result = {};
	SUPPORTED_LANGUAGES.forEach(lng => {
		// In normal translation we want everything to fall back to English so that we get some proper text no matter what.
		// But here we only want to return translations if they actually exist - or, in the case of British/American English, fall back to English after all.
		// So we have to override the fallback for the call.
		const fallbackLng = lng === 'en-GB' || lng === 'en-US' ? 'en' : lng;
		if (translationExists(key, { lng, fallbackLng })) {
			let translation = translate(key, { lng, fallbackLng });
			if (validator) {
				translation = validator(translation, key, lng);
			}
			if (translation) {
				result[lng] = translation;
			}
		}
	});
	return result;
}

function lengthValidator(min, max, translation, key, lng) {
	if (translation && translation.length >= min && translation.length <= max) {
		return translation;
	}
	logger.warn(
		'Translation provided for key %s in language %s is not between %d and %d characters long and has been skipped. Please adjust in translation file.\n' +
			'Translation is: %s',
		key,
		lng,
		min,
		max,
		translation
	);
	// Don't return translation so it won't be used.
}

function commandNameValidator(isOptionOrChatInputCommand, translation, key, lng) {
	translation = lengthValidator(1, COMMAND_NAME_CHARACTER_LIMIT, translation, key, lng);
	if (translation) {
		if (isOptionOrChatInputCommand) {
			if (!COMMAND_NAME_REGEXP.test(translation)) {
				logger.warn(
					'Translation provided for key %s in language %s does not match the regular expression defined by Discord for command and option names. ' +
						'It has been skipped. Please adjust in translation file.\n' +
						'Translation is: %s',
					key,
					lng,
					translation
				);
				// Don't return translation so it won't be used.
				return;
			}

			// According to https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-naming
			// "If there is a lowercase variant of any letters used, you must use those. Characters with no lowercase variants and/or uncased letters are still allowed."
			// If it only violates lower-case restriction, we can salvage it by lower-casing it but still log it so it can be changed in the translation file.
			const lowerCased = translation.toLocaleLowerCase(lng);
			if (lowerCased !== translation) {
				logger.warn(
					'Translation provided for key %s in language %s is not lower-cased. It will be used in lower-case but should be adjusted in the translation file.\n' +
						'Translation is: %s',
					key,
					lng,
					translation
				);
				return lowerCased;
			} else {
				return translation;
			}
		} else {
			// According to https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-naming
			// "USER and MESSAGE commands may be mixed case and can include spaces."
			// However in testing I noticed that other characters such as "?" and "'" are also accepted so for now no additional validation is applied for those names.
			return translation;
		}
	}
	// Don't return translation so it won't be used. lengthValidator should already have logged a warning.
}
