import pino from 'pino';

const transport = pino.transport({
	targets: [
		{
			target: 'pino-pretty',
			options: {
				ignore: 'pid,hostname',
				translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l'
			},
			level: 'info'
		},
		{
			target: 'pino/file',
			options: {
				destination: 'logs/log.ndjson',
				mkdir: true
			},
			level: 'info'
		}
	]
});

const logger = pino.default(transport);

export default logger;
