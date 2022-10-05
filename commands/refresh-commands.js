import { Constants, Permissions } from 'discord.js';
import { updateCommandsForSingleGuild } from '../command-handling/update-commands.js';
import { errorReply } from '../util/interaction-util.js';

const refreshCommandsCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'refresh-commands',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT,
		defaultMemberPermissions: new Permissions([Permissions.FLAGS.MANAGE_GUILD])
	},
	// Handler for when the command is used
	async execute(interaction, { t, logger }) {
		// Updating commands can take some time. So register a reply early on.
		await interaction.deferReply({ ephemeral: true });

		try {
			await updateCommandsForSingleGuild(interaction.client, interaction.guild);
		} catch (e) {
			logger.error(e, 'Error while trying to update commands for guild %s', interaction.guildId);
			await errorReply(interaction, t.user('reply.failure'));
			return;
		}

		await t.privateReply(interaction, 'reply.success');
	}
};

export default refreshCommandsCommand;
