import { Constants, Permissions } from 'discord.js';
import { updateCommandsForSingleGuild } from '../command-handling/update-commands.js';

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
			await interaction.editReply({
				content: t.user('reply.failure'),
				ephemeral: true
			});
			return;
		}

		await interaction.editReply({
			content: t.user('reply.success'),
			ephemeral: true
		});
	}
};

export default refreshCommandsCommand;
