import {
	EmbedBuilder,
	Colors,
	ActionRow,
	ButtonComponent,
	MessageComponentInteraction,
	InteractionReplyOptions,
	MessageActionRowComponent,
	MessageEditOptions,
	AnyComponent,
	APIButtonComponent,
	APIButtonComponentWithCustomId,
	BaseInteraction,
	GuildMember,
	APIInteractionGuildMember,
	APIActionRowComponent,
	APIMessageActionRowComponent,
	ChatInputCommandInteraction,
	StringSelectMenuInteraction,
	ComponentType
} from 'discord.js';
import { TFunction, TOptions, StringMap } from 'i18next';
import { ReplyableInteraction, Components } from './interaction-types.js';
import { CommandModule } from '../command-handling/command-module-types.js';
import {
	EMBED_DESCRIPTION_CHARACTER_LIMIT,
	EMBEDS_PER_MESSAGE_LIMIT,
	COLOUR_DISCORD_YELLOW
} from './discord-constants.js';
import { chunk, codePointLength } from './helpers.js';

export async function privateReply(
	t: TFunction,
	interaction: ReplyableInteraction,
	messageKey: string,
	options?: TOptions<StringMap>
) {
	await sendPrivateReply(interaction, { content: t(messageKey, options) });
}

export async function errorReply(
	interaction: ReplyableInteraction,
	text: string,
	components: Components | null = null,
	forceEphemeral = false
) {
	await borderedReply(interaction, text, components, forceEphemeral, Colors.Red);
}

export async function warningReply(
	interaction: ReplyableInteraction,
	text: string,
	components: Components | null = null,
	forceEphemeral = false
) {
	await borderedReply(interaction, text, components, forceEphemeral, COLOUR_DISCORD_YELLOW);
}

async function borderedReply(
	interaction: ReplyableInteraction,
	text: string,
	components: Components | null = null,
	forceEphemeral: boolean,
	colour: number
) {
	const message: InteractionReplyOptions = {
		embeds: [new EmbedBuilder().setDescription(text).setColor(colour)]
	};
	if (components) {
		message.components = components;
	}
	await sendPrivateReply(interaction, message, forceEphemeral);
}

export async function sendPrivateReply(
	interaction: ReplyableInteraction,
	message: InteractionReplyOptions,
	forceEphemeral = false
) {
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

export function getCustomIdForCommandRouting(command: CommandModule, innerId: string) {
	return '/' + command.configuration.name + '#' + innerId;
}

export async function sendListReply(interaction: ReplyableInteraction, listItems: string[], title: string) {
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

	const embeds = messageTexts.map(text => new EmbedBuilder().setDescription(text));
	embeds[0].setTitle(title);

	// TODO This is flawed. according to https://discord.com/developers/docs/resources/channel#embed-object-embed-limits we can send 6000 characters across *all* embeds, not per embed.
	//  So with a description character limit of 4096 characters we can't send more than one embed per message.
	// We can send up to EMBEDS_PER_MESSAGE_LIMIT embeds per message.
	const embedChunks = chunk(embeds, EMBEDS_PER_MESSAGE_LIMIT);

	const messages = embedChunks.map(embedChunk => {
		const message: InteractionReplyOptions = {
			embeds: embedChunk,
			allowedMentions: {
				parse: []
			},
			ephemeral: true
		};
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

export async function markSelectedButton(interaction: MessageComponentInteraction) {
	const selected = interaction.customId;
	await changeButtons(interaction, button => {
		button.disabled = true;
		if ((button as APIButtonComponentWithCustomId)?.custom_id === selected) {
			button.emoji = {
				id: null,
				name: '✅'
			};
		}
	});
}

export async function resetSelectionButtons(interaction: MessageComponentInteraction) {
	await changeButtons(interaction, button => {
		button.disabled = false;
		delete button.emoji;
	});
}

export async function disableButtons(interaction: MessageComponentInteraction) {
	await changeButtons(interaction, button => {
		button.disabled = true;
	});
}

async function changeButtons(
	interaction: MessageComponentInteraction,
	buttonModifier: (button: APIButtonComponent) => void
) {
	const components = interaction.message.components.map(component =>
		changeButtonsInActionRow(component, buttonModifier)
	);
	const message: MessageEditOptions = { components };
	if (interaction.deferred || interaction.replied) {
		await interaction.editReply(message);
	} else {
		await interaction.update(message);
	}
}

function changeButtonsInActionRow(
	component: ActionRow<MessageActionRowComponent>,
	buttonModifier: (button: APIButtonComponent) => void
) {
	const result: APIActionRowComponent<APIMessageActionRowComponent> = {
		...(component.data as APIActionRowComponent<APIMessageActionRowComponent>)
	};
	result.components = component.components.map(component => changeComponentIfButton(component, buttonModifier));
	return result;
}

function changeComponentIfButton(
	component: MessageActionRowComponent,
	buttonModifier: (button: APIButtonComponent) => void
) {
	const result: AnyComponent = { ...component.data };
	if (component instanceof ButtonComponent) {
		buttonModifier(result as APIButtonComponent);
	}
	return result;
}

export function getMember(interaction: BaseInteraction): GuildMember | null {
	if (interaction.member && isGuildMember(interaction.member)) {
		return interaction.member;
	}
	return null;
}

function isGuildMember(member: GuildMember | APIInteractionGuildMember): member is GuildMember {
	return (member as GuildMember).fetch !== undefined;
}

export function getMemberDisplayName(interaction: ChatInputCommandInteraction) {
	const member = getMember(interaction);
	if (member) {
		return member.displayName;
	} else {
		return interaction.user.username;
	}
}

export function isStringSelectMenuInteraction(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction
): interaction is StringSelectMenuInteraction {
	const stringSelectInteraction = interaction as StringSelectMenuInteraction;
	return (
		stringSelectInteraction.componentType === ComponentType.StringSelect && stringSelectInteraction.values !== undefined
	);
}

export function isChatInputCommandInteraction(
	interaction: ChatInputCommandInteraction | MessageComponentInteraction
): interaction is ChatInputCommandInteraction {
	return (interaction as ChatInputCommandInteraction).options !== undefined;
}
