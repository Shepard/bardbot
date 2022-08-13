export async function privateReply(t, interaction, messageKey, options) {
	await interaction.reply({
		content: t(messageKey, options),
		ephemeral: true
	});
}

export function getCustomIdForCommandRouting(command, innerId) {
	return '/' + command.configuration.name + '#' + innerId;
}
