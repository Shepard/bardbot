import { Constants, Permissions } from 'discord.js';
import { updateCommandsForSingleGuild } from '../command-handling/update-commands.js';

const refreshCommandsCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'refresh-commands',
		description: 'Refresh all commands in this server. Normally done automatically. Use in case of errors.',
		type: Constants.ApplicationCommandTypes.CHAT_INPUT
	},
	// Command is only usable by users in roles that have the Administrator flag set.
	// Until Discord implements the new command permission system, this means that the server owner
	// can't use the command without explicitly having an admin role.
	permissions: [Permissions.FLAGS.ADMINISTRATOR],
	// Handler for when the command is used
	async execute(interaction) {
		// Updating commands can take some time. So register a reply early on.
		await interaction.deferReply({ ephemeral: true });

		try {
			await updateCommandsForSingleGuild(interaction.client, interaction.guild);
		} catch (e) {
			console.error(`Error while trying to update commands for guild ${interaction.guildId}:`, e);
			await interaction.editReply({
				content: 'Commands could not be refreshed. This might be a temporary problem. Please try again later.',
				ephemeral: true
			});
			return;
		}

		await interaction.editReply({
			content: 'Commands successfully refreshed.',
			ephemeral: true
		});
	}
};

export default refreshCommandsCommand;
