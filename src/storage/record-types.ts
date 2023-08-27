import { Snowflake } from 'discord.js';
import { StoryMetadata } from '../story/story-types.js';

//-- Guild config

/**
 * Languages that we have translations for and that can be chosen in the guild configuration.
 * Compared to the InternalLanguage enum in i18n.ts this does not contain 'en'.
 * We mostly use 'en' as a fallback but don't want to offer it as a choice since it provides identical translations to en-GB and would just confuse the user.
 */
export enum SupportedLanguage {
	EnglishUS = 'en-US',
	EnglishGB = 'en-GB',
	German = 'de',
	SpanishES = 'es-ES'
}

export const SUPPORTED_LANGUAGE_TAGS: string[] = Object.values(SupportedLanguage);

export function isSupportedLanguage(languageTag: string): languageTag is SupportedLanguage {
	return SUPPORTED_LANGUAGE_TAGS.includes(languageTag as SupportedLanguage);
}

type PartialGuildConfiguration = { id: Snowflake };

export type FullGuildConfiguration = {
	id: Snowflake;
	bookmarksChannelId: Snowflake | null;
	quotesChannelId: Snowflake | null;
	language: SupportedLanguage | null;
	rolePlayChannelIds: Snowflake[];
};

export type GuildConfiguration = PartialGuildConfiguration | FullGuildConfiguration;

export type GuildConfigurationPatch = Omit<FullGuildConfiguration, 'rolePlayChannelIds'>;

export function isFullGuildConfiguration(guildConfig: GuildConfiguration): guildConfig is FullGuildConfiguration {
	return (guildConfig as FullGuildConfiguration).rolePlayChannelIds !== undefined;
}

export type RolePlayChannelsData = {
	rolePlayChannelId: Snowflake;
	webhookId: Snowflake;
};

//-- Message metadata

export type MessageMetadata = {
	messageId: Snowflake;
	channelId: Snowflake;
	guildId: Snowflake;
	sentTimestamp: number;
	interactingUserId: string;
	messageType: MessageType;
};

export enum MessageType {
	Bookmark = 'Bookmark',
	Quote = 'Quote',
	Arrival = 'Arrival',
	AltMessage = 'AltMessage'
}

//-- Alts

export interface BasicAlt {
	name: string;
	usableById: Snowflake;
	usableByType: UsableByType;
}

export interface Alt extends BasicAlt {
	id: number;
	guildId: Snowflake;
	avatarUrl: string;
}

/**
 * Used for specifying what type of object is referred to by the "usableById" property of an alternate character.
 * Either a "User" or a "Role".
 */
export enum UsableByType {
	User = 'User',
	Role = 'Role'
}

//-- Stories

export enum OwnerReportType {
	InkWarning = 'InkWarning',
	InkError = 'InkError',
	PotentialLoopDetected = 'PotentialLoopDetected',
	MaximumChoiceNumberExceeded = 'MaximumChoiceNumberExceeded'
}

export enum StoryStatus {
	Draft = 'Draft',
	Testing = 'Testing',
	Published = 'Published',
	Unlisted = 'Unlisted',
	ToBeDeleted = 'ToBeDeleted'
}

export class StoryRecord implements StoryMetadata {
	id: string;
	guildId: Snowflake;
	ownerId: Snowflake;
	title: string;
	author: string;
	teaser: string;
	status: StoryStatus;
	lastChanged: number;
	reportedInkError: boolean;
	reportedInkWarning: boolean;
	reportedMaximumChoiceNumberExceeded: boolean;
	reportedPotentialLoopDetected: boolean;
	timeBudgetExceededCount: number;

	constructor(resultRow) {
		this.id = resultRow.id;
		this.guildId = resultRow.guild_id;
		this.ownerId = resultRow.owner_id;
		this.title = resultRow.title;
		this.author = resultRow.author;
		this.teaser = resultRow.teaser;
		this.status = resultRow.status;
		this.lastChanged = resultRow.last_changed_timestamp;
		this.reportedInkError = !!resultRow.reported_ink_error;
		this.reportedInkWarning = !!resultRow.reported_ink_warning;
		this.reportedMaximumChoiceNumberExceeded = !!resultRow.reported_maximum_choice_number_exceeded;
		this.reportedPotentialLoopDetected = !!resultRow.reported_potential_loop_detected;
		this.timeBudgetExceededCount = resultRow.time_budget_exceeded_count;
	}

	hasIssueBeenReported(ownerReportType: OwnerReportType) {
		switch (ownerReportType) {
			case OwnerReportType.InkError:
				return this.reportedInkError;
			case OwnerReportType.InkWarning:
				return this.reportedInkWarning;
			case OwnerReportType.MaximumChoiceNumberExceeded:
				return this.reportedMaximumChoiceNumberExceeded;
			case OwnerReportType.PotentialLoopDetected:
				return this.reportedPotentialLoopDetected;
			default:
				return false;
		}
	}
}

export type StoryPlay = {
	storyRecord: StoryRecord;
	storyState: string;
};
