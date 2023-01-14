import {
	ApplicationCommandType,
	ApplicationCommandOptionType,
	ChatInputCommandInteraction,
	ModalBuilder,
	TextInputBuilder,
	ActionRowBuilder,
	ModalSubmitInteraction,
	TextInputStyle
} from 'discord.js';
import { CommandModule } from '../command-module-types.js';
import { MESSAGE_CONTENT_CHARACTER_LIMIT } from '../../util/discord-constants.js';
import { getCustomIdForCommandRouting } from '../../util/interaction-util.js';
import { ContextTranslatorFunctions } from '../../util/interaction-types.js';

const narrateCommand: CommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'narrate',
		description: '',
		type: ApplicationCommandType.ChatInput,
		options: [
			{
				name: 'story',
				description: '',
				type: ApplicationCommandOptionType.String,
				required: false,
				max_length: MESSAGE_CONTENT_CHARACTER_LIMIT
			}
		]
	},
	async execute(interaction, { t }) {
		const storyText = interaction.options.getString('story');
		if (storyText) {
			await sendNarration(interaction, storyText);
		} else {
			await showNarrationInputDialog(interaction, t);
		}
	},
	async modalInteraction(interaction) {
		await receiveNarrationInputDialog(interaction);
	}
};

async function sendNarration(interaction: ChatInputCommandInteraction | ModalSubmitInteraction, storyText: string) {
	await interaction.reply({
		content: storyText,
		// We could try to find out which roles the member is allowed to ping in a complicated way
		// but it's easier to just restrict it to none.
		allowedMentions: {
			parse: []
		}
	});
}

async function showNarrationInputDialog(interaction: ChatInputCommandInteraction, t: ContextTranslatorFunctions) {
	const dialogId = getCustomIdForCommandRouting(narrateCommand, '');
	const inputDialog = new ModalBuilder().setCustomId(dialogId).setTitle(t.user('reply.dialog-title'));

	const messageEditField = new TextInputBuilder()
		.setCustomId('story-text')
		.setLabel(t.user('reply.story-text-field-label'))
		.setStyle(TextInputStyle.Paragraph)
		.setRequired(true)
		.setMinLength(1)
		.setMaxLength(MESSAGE_CONTENT_CHARACTER_LIMIT);

	inputDialog.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(messageEditField));

	await interaction.showModal(inputDialog);
}

async function receiveNarrationInputDialog(interaction: ModalSubmitInteraction) {
	const storyText = interaction.fields.getTextInputValue('story-text');
	await sendNarration(interaction, storyText);
}

export default narrateCommand;
