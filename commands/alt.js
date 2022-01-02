import { Constants } from 'discord.js';
import { addMessageMetadata, MessageType } from '../storage/message-metadata-dao.js';
import { getWebhookIdForRolePlayChannel } from '../storage/guild-config-dao.js';
import { findMatchingAlts, getAlt, getNumberOfAlts, UsableByType } from '../storage/alt-dao.js';

const altCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'alt',
		description: 'Write messages through an alternate character.',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'name',
				description: 'The name of the alt you want to pick',
				type: Constants.ApplicationCommandOptionTypes.STRING,
				required: true,
				autocomplete: true
			},
			{
				name: 'message',
				description: 'The message the alternate character should send',
				type: Constants.ApplicationCommandOptionTypes.STRING,
				required: true
			}
		]
	},
	// Test function to check if the command should apply to a guild
	guard(client, guild, guildConfig) {
		return guildConfig?.rolePlayChannels?.length && getNumberOfAlts(guild.id) > 0;
	},
	// Handler for when the command is used
	async execute(interaction) {
		const altName = interaction.options.getString('name');
		const messageText = interaction.options.getString('message');

		const webhook = await getWebhook(interaction);
		if (!webhook) {
			// getWebhook already handled telling the user about it.
			return;
		}

		try {
			let alt = null;
			try {
				alt = getAlt(interaction.guildId, altName);
			} catch (e) {
				console.error('Error while trying to fetch alt from db:', e);
				await interaction.reply({
					content:
						'An error occurred while trying to find the alternate character in the database. Please try again later.',
					ephemeral: true
				});
				return;
			}
			if (!alt) {
				await interaction.reply({
					content: `There is no alternate character by the name "${altName}".`,
					ephemeral: true
				});
				return;
			}
			if (!isUsableByUser(alt, interaction)) {
				await interaction.reply({
					content: `The alternate character "${altName}" cannot be used for role-play by you.`,
					ephemeral: true
				});
				return;
			}

			// Channels not viewable by the bot can cause problems so we don't allow alts to be used there.
			// The webhook can send the message but we don't get messageDelete events for it and /where currently excludes such channels as well.
			if (!interaction.channel.viewable) {
				await interaction.reply({
					content: 'This is not a place I can see, unfortunately. So you cannot use alternate characters here.',
					ephemeral: true
				});
				return;
			}

			// Send message using webhook for this RP channel and with the name and avatar or the alt picked by the user.
			const altMessage = await webhook.send({
				content: messageText,
				username: alt.name,
				avatarURL: alt.avatarUrl,
				// We could try to find out which roles the member is allowed to ping in a complicated way but it's easier to just restrict it to none.
				allowed_mentions: {
					parse: []
				}
			});

			try {
				// We need to reply to the interaction as well, otherwise it will be shown as pending and eventually failed.
				// Since we don't really want to show a reply every time an alt message was sent, we send it and immediately delete it again.
				await interaction.reply({
					content: 'Alt message posted.'
					// Can't be ephemeral because then it can't be deleted.
				});
				await interaction.deleteReply();
			} catch (e) {
				console.error('Error while trying to handle interaction reply after sending alt message:', e);
			}

			// Record the alt message as sent by the user.
			addMessageMetadata(altMessage, interaction.user.id, MessageType.AltMessage);
		} catch (e) {
			console.error('Error while trying to send alt message:', e);
			await interaction.reply({
				content: 'Sending message using alt failed.',
				ephemeral: true
			});
		}
	},
	async autocomplete(interaction) {
		const focusedOption = interaction.options.getFocused(true);
		if (focusedOption.name === 'name') {
			// Once we can get user locales from interactions, we can use those instead.
			const collator = new Intl.Collator('en');
			const matchingAlts = findMatchingAlts(interaction.guildId, focusedOption.value);
			return (
				matchingAlts
					.filter(alt => isUsableByUser(alt, interaction))
					.map(alt => ({ name: alt.name, value: alt.name }))
					// The database already does some sorting for us but it's not very good at proper i18n sorting.
					.sort((a, b) => collator.compare(a?.name, b?.name))
			);
		} else {
			return [];
		}
	}
};

async function getWebhook(interaction) {
	let webhookId = null;
	try {
		webhookId = getWebhookIdForRolePlayChannel(interaction.guildId, interaction.channelId);
	} catch (e) {
		console.error(
			`Loading webhook id from database for channel ${interaction.channelId} in guild ${interaction.guildId} failed:`,
			e
		);
		await interaction.reply({
			content: 'Sending message using alt failed.',
			ephemeral: true
		});
		return null;
	}
	if (webhookId) {
		try {
			return interaction.client.fetchWebhook(webhookId);
		} catch (e) {
			console.error('Fetching webhook failed:', e);
			await interaction.reply({
				content: 'Sending message using alt failed.',
				ephemeral: true
			});
		}
	} else {
		await interaction.reply({
			content: 'This is not a role-play channel. You cannot use alternate characters here.',
			ephemeral: true
		});
	}
	return null;
}

function isUsableByUser(alt, interaction) {
	if (alt.usableByType === UsableByType.User) {
		return interaction.user.id === alt.usableById;
	} else if (alt.usableByType === UsableByType.Role) {
		return interaction.member.roles.cache.has(alt.usableById);
	} else {
		console.error(`Unsupported type ${alt.usableByType} used for alt "${alt.name}" in guild ${interaction.guildId}.`);
		return false;
	}
}

export default altCommand;
