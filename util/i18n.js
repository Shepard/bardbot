import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { userMention, channelMention, roleMention, time } from '@discordjs/builders';
import { privateReply } from './interaction-util.js';

const INTERNAL_LANGUAGES = Object.freeze(['en', 'en-US', 'en-GB', 'de', 'es-ES']);

export const SUPPORTED_LANGUAGES = Object.freeze(
	INTERNAL_LANGUAGES
		// We mostly use 'en' as a fallback but don't want to offer it as a choice since it provides identical translations to en-GB and would just confuse the user.
		.filter(languageTag => languageTag !== 'en')
);

let i18n;

export async function initI18n() {
	i18n = i18next
		.createInstance({
			supportedLngs: INTERNAL_LANGUAGES,
			fallbackLng: 'en',
			// Since we're a server application and don't need to worry about bandwidth, we can preload all supported languages.
			preload: INTERNAL_LANGUAGES,
			ns: 'main',
			defaultNS: 'main',
			returnNull: false,
			backend: {
				loadPath: './locales/{{ns}}/{{lng}}.json5'
			},
			interpolation: {
				// We're not printing HTML so we don't need escaping to prevent XSS.
				escapeValue: false
			}
		})
		.use(Backend);
	await i18n.init();

	// Some formatters for using Discord syntax in translations.
	// These have to be added as lowercase strings because i18next lowercases formatters found in translations and searches for them that way.
	i18n.services.formatter.add('usermention', value => {
		return userMention(value);
	});
	i18n.services.formatter.add('channelmention', value => {
		return channelMention(value);
	});
	i18n.services.formatter.add('rolemention', value => {
		return roleMention(value);
	});
	i18n.services.formatter.add('time', (value, lng, options) => {
		return time(value, options?.style);
	});
}

export function translate(keys, options) {
	return i18n.t(keys, options);
}

export function translationExists(key, options) {
	return i18n.exists(key, options);
}

export function getTranslatorForInteraction(interaction, command, guildConfig) {
	const userLocale = interaction.locale ?? 'en';
	const guildLocale = guildConfig.language ?? interaction.guildLocale ?? 'en';
	const commandPrefix = 'commands.' + (command.i18nKeyPrefix ?? interaction.commandName);
	const sharedPrefix = 'shared';
	const t = {
		user: i18n.getFixedT(userLocale, null, commandPrefix),
		guild: i18n.getFixedT(guildLocale, null, commandPrefix),
		userShared: i18n.getFixedT(userLocale, null, sharedPrefix),
		guildShared: i18n.getFixedT(guildLocale, null, sharedPrefix)
	};
	t.privateReply = privateReply.bind(t, t.user);
	t.privateReplyShared = privateReply.bind(t, t.userShared);
	return t;
}
