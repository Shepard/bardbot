import schedule from 'node-schedule';
import { deleteOutdatedMessageMetadata } from './message-metadata-dao.js';

const rule = new schedule.RecurrenceRule();
rule.hour = 6;
rule.minute = 0;
rule.tz = 'Etc/UTC';

schedule.scheduleJob(rule, () => {
	try {
		const numChanges = deleteOutdatedMessageMetadata();
		console.log(`Daily cleanup of outdated message metadata removed ${numChanges} record(s).`);
	} catch (e) {
		console.error('Error while trying to run daily cleanup of outdated message metadata:', e);
	}
});
