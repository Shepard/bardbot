import { hyperlink, channelMention, userMention } from '@discordjs/builders';
import { Constants, Permissions, MessageEmbed } from 'discord.js';
import { findNewestRPMessageMetadata } from '../storage/message-metadata-dao.js';

// Determines how many message back the command searches in each channel.
// It will fetch MESSAGE_BATCH many messages for up to MAX_ITERATIONS times.
const MESSAGE_BATCH = 100;
const MAX_ITERATIONS = 5;

const whereCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'where',
		description: 'Tries to find the location (role-play channel) where a character was last seen acting.',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		options: [
			{
				name: 'user',
				description: 'The user to look for. Leave empty to look for yourself.',
				type: Constants.ApplicationCommandOptionTypes.USER,
				required: false
			}
		]
	},
	// Test function to check if the command should apply to a guild
	guard(client, guild, guildConfig) {
		return guildConfig?.rolePlayChannels?.length;
	},
	// Handler for when the command is used
	async execute(interaction, guildConfig) {
		// Defer reply for now so we get more time to reply because fetching all the messages can take some time.
		await interaction.deferReply({ ephemeral: true });

		// Find all configured role-play channels.
		const rolePlayChannelIds = guildConfig.rolePlayChannels;
		const guildChannels = await interaction.guild.channels.fetch();
		const channelsToSearch = rolePlayChannelIds
			.map(channelId => guildChannels.get(channelId))
			.filter(channel => {
				// Does the channel exist in this guild and is it visible to the bot?
				if (channel?.viewable) {
					// We only want to search messages in the channels that the current user is allowed to see messages from.
					const currentMemberPermissions = channel.permissionsFor(interaction.member);
					return (
						currentMemberPermissions.has(Permissions.FLAGS.VIEW_CHANNEL) &&
						currentMemberPermissions.has(Permissions.FLAGS.READ_MESSAGE_HISTORY)
					);
				}
				return false;
			});
		const channelIdsToSearch = channelsToSearch.map(channel => channel.id);

		const userToFind = getUser(interaction);
		const findingCurrentUser = userToFind.id === interaction.user.id;

		// Find message metadata for the newest message associated with the user and belonging to RP channels in the guild.
		// This lets us consider interactions by the user that are RP-related
		// but produced a message by the bot that is not linked to a Discord interaction
		// (for example the message in the destination channel produced by /goto).
		const newestMessageMetadata = findNewestRPMessageMetadata(userToFind.id, interaction.guildId, channelIdsToSearch);

		// Find the message.
		const newestUserMessage = await findNewestUserMessage(userToFind, channelsToSearch, newestMessageMetadata);

		if (newestUserMessage) {
			const messageText = findingCurrentUser
				? `You were ${hyperlink('last seen', newestUserMessage.url)} role-playing in ${channelMention(
						newestUserMessage.channelId
				  )}.`
				: `${userMention(userToFind.id)} was ${hyperlink(
						'last seen',
						newestUserMessage.url
				  )} role-playing in ${channelMention(newestUserMessage.channelId)}.`;
			await interaction.editReply({
				embeds: [new MessageEmbed().setDescription(messageText)]
			});
		} else {
			const messageText = findingCurrentUser
				? "Could not find a recent message by you in any of the role-play channels. Your last role-play must have been a while back or you haven't role-played yet!"
				: `Could not find a recent message by ${userMention(
						userToFind.id
				  )} in any of the role-play channels. Their last role-play must have been a while back or they haven't role-played yet!`;
			await interaction.editReply({ content: messageText });
		}
	}
};

function getUser(interaction) {
	const user = interaction.options.getUser('user');
	if (user) {
		return user;
	}
	return interaction.user;
}

async function findNewestUserMessage(userToFind, channelsToSearch, newestMessageMetadata) {
	let channelsToSearchAndOldestMessageIds = channelsToSearch.map(channel => [channel, null]);
	let newestMessage = null;
	let i = 0;

	do {
		// matchDataPerChannel will be of the shape [[channel, match or undefined, oldest message id], ...]
		const matchDataPerChannel = await findInBatch(userToFind, channelsToSearchAndOldestMessageIds);
		channelsToSearchAndOldestMessageIds = matchDataPerChannel.map(matchData => [matchData[0], matchData[2]]);
		matchDataPerChannel
			.map(matchData => matchData[1])
			.forEach(message => {
				if (message && (newestMessage == null || message.createdTimestamp > newestMessage.createdTimestamp)) {
					newestMessage = message;
				}
			});
		i++;
	} while (!newestMessage && i < MAX_ITERATIONS);

	// If we have metadata recorded for a message that is newer than the newest message by the user we found,
	// or if we didn't find any message by the user, try to load and return that message.
	if (
		newestMessageMetadata &&
		(!newestMessage || newestMessageMetadata.sentTimestamp > newestMessage.createdTimestamp)
	) {
		const channelForNewestMessageMetadata = channelsToSearch.find(
			channel => channel.id === newestMessageMetadata.channelId
		);
		if (channelForNewestMessageMetadata) {
			try {
				const fetchedMessage = await channelForNewestMessageMetadata.messages.fetch(newestMessageMetadata.messageId);
				if (fetchedMessage) {
					newestMessage = fetchedMessage;
				}
			} catch (e) {
				console.error(e);
			}
		}
	}

	return newestMessage;
}

async function findInBatch(userToFind, channelsToSearchAndOldestMessageIds) {
	return Promise.all(
		channelsToSearchAndOldestMessageIds.map(channelAndOldestMessageId =>
			findInBatchInChannel(userToFind, channelAndOldestMessageId[0], channelAndOldestMessageId[1])
		)
	);
}

async function findInBatchInChannel(userToFind, channel, oldestMessageId) {
	const queryParams = { limit: MESSAGE_BATCH };
	if (oldestMessageId) {
		queryParams.before = oldestMessageId;
	}
	const messageBatch = await channel.messages.fetch(queryParams);

	// Find a message where the user is either the author, or, if it was a bot interaction, the interacting user.
	// Since the messages are sorted by newest to oldest, we can use find to get the first matching message and will end up with the newest of them.
	const matchingMessage = messageBatch.find(
		message => message.author.id === userToFind.id || message.interaction?.user.id === userToFind.id
	);

	const newOldestMessageId = messageBatch.last().id;

	return [channel, matchingMessage, newOldestMessageId];
}

export default whereCommand;