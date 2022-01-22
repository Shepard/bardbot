import pino from 'pino';

const transport = pino.transport({
	targets: [
		{
			target: 'pino-pretty',
			options: {
				ignore: 'pid,hostname',
				translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l'
			}
		},
		{
			target: 'pino/file',
			options: {
				destination: 'logs/log.ndjson',
				mkdir: true
			}
		}
	]
});

const logger = pino(transport);

export default logger;
