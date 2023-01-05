import { ApplicationCommandType, MessageContextMenuCommandInteraction } from 'discord.js';
import { TFunction } from 'i18next';
import { CommandModule } from '../command-module-types.js';
import { getMessageMetadata } from '../../storage/message-metadata-dao.js';
import { warningReply } from '../../util/interaction-util.js';
import RandomMessageProvider from '../../util/random-message-provider.js';

export const blameMessages = new RandomMessageProvider()
	.add((user, t) => t('reply.blame1', { user }))
	.add((user, t) => t('reply.blame2', { user }))
	.add((user, t) => t('reply.blame3', { user }))
	.add((user, t) => t('reply.blame4', { user }))
	.add((user, t) => t('reply.blame5', { user }))
	.add((user, t) => t('reply.blame6', { user }));

const blameContextCommand: CommandModule<MessageContextMenuCommandInteraction> = {
	configuration: {
		name: 'Who dunnit?',
		type: ApplicationCommandType.Message,
		dmPermission: false
	},
	i18nKeyPrefix: 'blame-context',
	async execute(interaction, { t, logger }) {
		// Get message that the context menu command was used on.
		const message = interaction.targetMessage;
		if (message) {
			if (message.interaction) {
				// While this might seem superfluous because the user of an interaction reply is clearly shown in Discord,
				// it would be even weirder for the bot to go "I don't know.". So it's just for the sake of completeness.
				await replyWithUser(interaction, message.interaction.user.id, t.user);
			} else {
				const metadata = getMessageMetadata(message.id, logger);
				if (metadata) {
					await replyWithUser(interaction, metadata.interactingUserId, t.user);
				} else {
					await warningReply(interaction, t.user('reply.user-unknown'));
				}
			}
		} else {
			await warningReply(interaction, t.user('reply.message-not-found'));
		}
	}
};

async function replyWithUser(interaction: MessageContextMenuCommandInteraction, userId: string, t: TFunction) {
	await interaction.reply({
		content: blameMessages.any(userId, t),
		ephemeral: true
	});
}

export default blameContextCommand;
