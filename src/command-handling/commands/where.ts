import {
	ApplicationCommandType,
	ApplicationCommandOptionType,
	PermissionFlagsBits,
	EmbedBuilder,
	ChatInputCommandInteraction,
	User,
	GuildTextBasedChannel,
	Channel,
	FetchMessagesOptions,
	Message
} from 'discord.js';
import { Logger } from 'pino';
import { GuildCommandModule } from '../command-module-types.js';
import { FullGuildConfiguration, MessageMetadata } from '../../storage/record-types.js';
import { findNewestRPMessageMetadata } from '../../storage/message-metadata-dao.js';
import { getMember } from '../../util/interaction-util.js';

// Determines how many messages back the command searches in each channel.
// It will fetch MESSAGE_BATCH many messages for up to MAX_ITERATIONS times.
const MESSAGE_BATCH = 100;
const MAX_ITERATIONS = 5;

const whereCommand: GuildCommandModule<ChatInputCommandInteraction> = {
	configuration: {
		name: 'where',
		description: '',
		type: ApplicationCommandType.ChatInput,
		options: [
			{
				name: 'user',
				description: '',
				type: ApplicationCommandOptionType.User,
				required: false
			}
		]
	},
	guard(guildConfig) {
		return (guildConfig as FullGuildConfiguration)?.rolePlayChannelIds?.length > 0;
	},
	async execute(interaction, { t, guildConfig, logger }) {
		// Defer reply for now so we get more time to reply because fetching all the messages can take some time.
		await interaction.deferReply({ ephemeral: true });

		// Find all configured role-play channels.
		const rolePlayChannelIds = (guildConfig as FullGuildConfiguration).rolePlayChannelIds;
		const guildChannels = await interaction.guild.channels.fetch();
		function isTextBased(channel: Channel): channel is GuildTextBasedChannel {
			return channel.isTextBased() && !channel.isDMBased();
		}
		const channelsToSearch: GuildTextBasedChannel[] = rolePlayChannelIds
			.map(channelId => guildChannels.get(channelId))
			.map(channel => channel as Channel)
			.filter(isTextBased)
			.filter(channel => {
				// Does the channel exist in this guild and is it visible to the bot?
				if (channel?.viewable) {
					const member = getMember(interaction);
					if (member) {
						// We only want to search messages in the channels that the current user is allowed to see messages from.
						const currentMemberPermissions = channel.permissionsFor(member);
						return (
							currentMemberPermissions.has(PermissionFlagsBits.ViewChannel) &&
							currentMemberPermissions.has(PermissionFlagsBits.ReadMessageHistory)
						);
					}
				}
				return false;
			});
		const channelIdsToSearch = channelsToSearch.map(channel => channel.id);

		// TODO Also include threads in RP channels that are:
		// - public or
		//   private with the interacting user being a member
		// - active or archived or even locked

		const userToFind = getUser(interaction);
		const findingCurrentUser = userToFind.id === interaction.user.id;

		// Find message metadata for the newest message associated with the user and belonging to RP channels in the guild.
		// This lets us consider interactions by the user that are RP-related
		// but produced a message by the bot that is not linked to a Discord interaction
		// (for example the message in the destination channel produced by /goto).
		const newestMessageMetadata = findNewestRPMessageMetadata(
			userToFind.id,
			interaction.guildId,
			channelIdsToSearch,
			logger
		);

		// Find the message.
		const newestUserMessage = await findNewestUserMessage(userToFind, channelsToSearch, newestMessageMetadata, logger);

		if (newestUserMessage) {
			const messageText = findingCurrentUser
				? t.user('reply.you-last-seen', { url: newestUserMessage.url, channel: newestUserMessage.channelId })
				: t.user('reply.user-last-seen', {
						user: userToFind.id,
						url: newestUserMessage.url,
						channel: newestUserMessage.channelId
				  });
			await interaction.editReply({
				embeds: [new EmbedBuilder().setDescription(messageText)]
			});
		} else {
			const messageText = findingCurrentUser
				? t.user('reply.you-not-found')
				: t.user('reply.user-not-found', { user: userToFind.id });
			await interaction.editReply({ content: messageText });
		}
	}
};

function getUser(interaction: ChatInputCommandInteraction) {
	const user = interaction.options.getUser('user');
	if (user) {
		return user;
	}
	return interaction.user;
}

async function findNewestUserMessage(
	userToFind: User,
	channelsToSearch: GuildTextBasedChannel[],
	newestMessageMetadata: MessageMetadata,
	logger: Logger
) {
	let channelsToSearchAndOldestMessageIds: [GuildTextBasedChannel, string | null][] = channelsToSearch.map(channel => [
		channel,
		null
	]);
	let newestMessage = null;
	let i = 0;

	do {
		// matchDataPerChannel will be of the shape [[channel, match or undefined, oldest message id], ...]
		const matchDataPerChannel = await findInBatch(userToFind, channelsToSearchAndOldestMessageIds);
		channelsToSearchAndOldestMessageIds = matchDataPerChannel
			// While the first round explicitly puts nulls for the oldest messages ids (because we don't know any yet),
			// after the first search result this means the channel didn't have any messages, so we're filtering it out.
			.filter(matchData => !!matchData[2])
			.map(matchData => [matchData[0], matchData[2]]);
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
				logger.error(e);
			}
		}
	}

	return newestMessage;
}

async function findInBatch(
	userToFind: User,
	channelsToSearchAndOldestMessageIds: [GuildTextBasedChannel, string | null][]
) {
	return Promise.all(
		channelsToSearchAndOldestMessageIds.map(channelAndOldestMessageId =>
			findInBatchInChannel(userToFind, channelAndOldestMessageId[0], channelAndOldestMessageId[1])
		)
	);
}

async function findInBatchInChannel(
	userToFind: User,
	channel: GuildTextBasedChannel,
	oldestMessageId: string | null
): Promise<[GuildTextBasedChannel, Message, string | null]> {
	const queryParams: FetchMessagesOptions = { limit: MESSAGE_BATCH };
	if (oldestMessageId) {
		queryParams.before = oldestMessageId;
	}
	const messageBatch = await channel.messages.fetch(queryParams);

	// Find a message where the user is either the author, or, if it was a bot interaction, the interacting user.
	// Since the messages are sorted by newest to oldest, we can use find to get the first matching message and will end up with the newest of them.
	const matchingMessage = messageBatch.find(
		message => message.author.id === userToFind.id || message.interaction?.user.id === userToFind.id
	);

	const newOldestMessageId = messageBatch.last()?.id;

	return [channel, matchingMessage, newOldestMessageId];
}

export default whereCommand;
