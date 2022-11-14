import { ApplicationCommandType, userMention } from 'discord.js';
import { sendListReply } from '../util/interaction-util.js';

const namesCommand = {
	// Configuration for registering the command
	configuration: {
		name: 'names',
		type: ApplicationCommandType.ChatInput
	},
	// Handler for when the command is used
	async execute(interaction, { t }) {
		// Defer reply for now so we get more time to reply in case fetching the member list takes an unusual amount of time.
		await interaction.deferReply();

		// Retrieve all (non-bot) members of this guild and add their names to the list.
		const members = await interaction.guild.members.fetch();
		const membersList = members
			.filter(member => !member.user.bot && member.user.username !== member.displayName)
			.map(member => `${member.displayName} - ${userMention(member.id)}`);

		await sendListReply(
			interaction,
			membersList,
			t.guild('reply.title', { guildName: interaction.guild.name }),
			// Suppress mentions because we don't want to ping people.
			true,
			// Should be publicly visible and for the permanent record, not ephemeral.
			false
		);
	}
};

export default namesCommand;
