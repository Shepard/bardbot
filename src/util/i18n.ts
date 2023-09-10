import i18next, { TOptions, StringMap } from 'i18next';
import Backend from 'i18next-fs-backend';
import { userMention, channelMention, roleMention, time, BaseInteraction } from 'discord.js';
import prettyBytes from 'pretty-bytes';
import { ContextTranslatorFunctions } from './interaction-types.js';
import { privateReply } from './interaction-util.js';
import { commandMention } from '../command-handling/command-id-cache.js';
import { CommandModule } from '../command-handling/command-module-types.js';
import { GuildConfiguration, FullGuildConfiguration } from '../storage/record-types.js';

/**
 * Languages that we have translations for.
 */
enum InternalLanguage {
	English = 'en',
	EnglishUS = 'en-US',
	EnglishGB = 'en-GB',
	German = 'de',
	SpanishES = 'es-ES'
}
const INTERNAL_LANGUAGES: string[] = Object.values(InternalLanguage);

let i18n: i18next.i18n;

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
	i18n.services.formatter.add('commandmention', (value, lng, options) => {
		return commandMention(value, options?.guildId);
	});
	i18n.services.formatter.add('time', (value, lng, options) => {
		return time(value, options?.style);
	});
	i18n.services.formatter.add('bytes', (value, lng) => {
		return prettyBytes(value, { locale: lng });
	});
}

export function translate(keys: string | string[], options: TOptions<StringMap>): string {
	return i18n.t(keys, options);
}

export function translationExists(key: string | string[], options: TOptions<StringMap>): boolean {
	return i18n.exists(key, options);
}

export function getTranslatorForInteraction(
	interaction: BaseInteraction,
	command: CommandModule,
	guildConfig: GuildConfiguration
): ContextTranslatorFunctions {
	const userLocale = interaction.locale ?? 'en';
	const guildLocale = interaction.inGuild()
		? (guildConfig as FullGuildConfiguration).language ?? interaction.guildLocale ?? 'en'
		: userLocale;
	const commandPrefix = 'commands.' + (command.i18nKeyPrefix ?? command.configuration.name);
	const sharedPrefix = 'shared';
	const t = {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		/* @ts-ignore Avoid TS2589 ("Type instantiation is excessively deep and possibly infinite.") */
		user: i18n.getFixedT(userLocale, null, commandPrefix),
		guild: i18n.getFixedT(guildLocale, null, commandPrefix),
		userShared: i18n.getFixedT(userLocale, null, sharedPrefix),
		guildShared: i18n.getFixedT(guildLocale, null, sharedPrefix),
		privateReply: null,
		privateReplyShared: null
	};
	t.privateReply = privateReply.bind(t, t.user);
	t.privateReplyShared = privateReply.bind(t, t.userShared);
	return t;
}
