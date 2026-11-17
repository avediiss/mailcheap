// Creates, shows or removes the GTM agent's three-hourly radar scan in QStash. See lib/gtm/radar-jobs.js.
//
//   QSTASH_TOKEN=... APP_URL=https://... node scripts/gtm-schedule.mjs --show
//   QSTASH_TOKEN=... APP_URL=https://... node scripts/gtm-schedule.mjs --create
//   QSTASH_TOKEN=... APP_URL=https://... node scripts/gtm-schedule.mjs --remove
//
// A deploy-time step, run once per environment: QStash calls a public URL, so it can't be a local one.
// --create is safe to run again — the schedule has a fixed id, so it updates rather than duplicating.
// The schedule can stay in place while GTM_ENABLED is off: the job then logs that it skipped.
import {
	GTM_RADAR_SCHEDULE_ID,
	createGtmRadarSchedule,
	getGtmRadarCron,
	getGtmRadarUrl,
	getGtmRadarSchedule,
	removeGtmRadarSchedule,
} from "../lib/gtm/radar-schedule.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

if (!process.env.QSTASH_TOKEN) {
	console.error("QSTASH_TOKEN is not set");
	process.exit(1);
}

const actions = ["create", "remove", "show"].filter(flag);
if (actions.length !== 1) {
	console.error("Give exactly one of --create, --remove or --show");
	process.exit(1);
}

try {
	if (flag("create")) {
		const { scheduleId, destination, cron } = await createGtmRadarSchedule();
		console.log(`Scheduled "${scheduleId}": ${cron} -> POST ${destination}`);
		console.log("Switch the module on with GTM_ENABLED=true, or the scan will log that it skipped.");
	} else if (flag("remove")) {
		await removeGtmRadarSchedule();
		console.log(`Removed "${GTM_RADAR_SCHEDULE_ID}".`);
	} else {
		const schedule = await getGtmRadarSchedule();
		if (!schedule) {
			console.log(`No "${GTM_RADAR_SCHEDULE_ID}" schedule. Expected: ${getGtmRadarCron()} -> POST ${getGtmRadarUrl()}`);
			console.log("Create it with --create.");
		} else {
			console.log(`"${schedule.scheduleId}": ${schedule.cron} -> ${schedule.method} ${schedule.destination}`);
			console.log(`Paused: ${schedule.isPaused}. Created: ${new Date(schedule.createdAt).toISOString()}.`);
		}
	}
} catch (error) {
	console.error(`\nStopped: ${error.message}`);
	process.exitCode = 1;
}
