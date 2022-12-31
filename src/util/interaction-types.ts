import { TFunction, TOptions, StringMap } from 'i18next';
import {
	ActionRowData,
	APIActionRowComponent,
	APIMessageActionRowComponent,
	ButtonStyle,
	CommandInteraction,
	MessageActionRowComponentBuilder,
	MessageActionRowComponentData,
	MessageComponentInteraction,
	ModalSubmitInteraction
} from 'discord.js';
import { Level, Logger } from 'pino';
import { GuildConfiguration } from '../storage/record-types.js';

export type ReplyableInteraction = CommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

export type ContextTranslatorFunctions = {
	user: TFunction;
	guild: TFunction;
	userShared: TFunction;
	guildShared: TFunction;
	privateReply: (interaction: ReplyableInteraction, messageKey: string, options?: TOptions<StringMap>) => Promise<void>;
	privateReplyShared: (
		interaction: ReplyableInteraction,
		messageKey: string,
		options?: TOptions<StringMap>
	) => Promise<void>;
};

export type InteractionExecutionContext = {
	guildConfig: GuildConfiguration;
	t: ContextTranslatorFunctions;
	logger: Logger;
};

export type Components = (
	| ActionRowData<MessageActionRowComponentData | MessageActionRowComponentBuilder>
	| APIActionRowComponent<APIMessageActionRowComponent>
)[];

/**
 * Discord button styles without the link button style.
 */
export type InteractionButtonStyle = Exclude<ButtonStyle, ButtonStyle.Link>;
