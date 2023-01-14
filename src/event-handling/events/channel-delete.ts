import { DMChannel, NonThreadGuildBasedChannel } from 'discord.js';
import { ClientEventHandler } from '../event-handler-types.js';
import logger from '../../util/logger.js';
import {
	getGuildConfig,
	removeRolePlayChannel,
	setBookmarksChannel,
	setQuotesChannel
} from '../../storage/guild-config-dao.js';
import { isFullGuildConfiguration } from '../../storage/record-types.js';
import { updateCommandsForSingleGuild } from '../../command-handling/update-commands.js';

const channelDeleteEvent: ClientEventHandler<'channelDelete'> = {
	name: 'channelDelete',
	execute(channel: DMChannel | NonThreadGuildBasedChannel) {
		if (isGuildBasedChannel(channel)) {
			handleChannelDelete(channel).catch(e => logger.error(e));
		}
	}
};

async function handleChannelDelete(channel: NonThreadGuildBasedChannel) {
	const guildConfig = getGuildConfig(channel.guildId, logger);
	if (isFullGuildConfiguration(guildConfig)) {
		try {
			let configChanged = false;
			if (channel.id === guildConfig.quotesChannelId) {
				setQuotesChannel(channel.guildId, null);
				configChanged = true;
			}
			if (channel.id === guildConfig.bookmarksChannelId) {
				setBookmarksChannel(channel.guildId, null);
				configChanged = true;
			}
			if (guildConfig.rolePlayChannelIds.includes(channel.id)) {
				removeRolePlayChannel(channel.guildId, channel.id);
				configChanged = true;
			}

			if (configChanged) {
				try {
					await updateCommandsForSingleGuild(channel.guild);
				} catch (error) {
					logger.error(
						error,
						'Error while trying to update commands for guild %s after remove deleted channel from configuration',
						channel.guildId
					);
				}
			}
		} catch (error) {
			logger.error(
				error,
				'Database error while trying to remove deleted channel %s from configuration of guild %s',
				channel.id,
				channel.guildId
			);
		}
	}
}

function isGuildBasedChannel(channel: DMChannel | NonThreadGuildBasedChannel): channel is NonThreadGuildBasedChannel {
	return (channel as NonThreadGuildBasedChannel).guild !== undefined;
}

export default channelDeleteEvent;
