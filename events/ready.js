const readyEvent = {
	name: 'ready',
	once: true,
	execute(client) {
		console.log(`Client is connected. Logged in as ${client.user.tag}.`);
	},
};

export default readyEvent;