import { Client } from "@upstash/qstash";
import { getAppUrl } from "../config.js";
import { GTM_LIMITS } from "./config.js";

// The QStash schedule behind the radar scan. Namag had no recurring scheduler — every other job is
// one-shot or reschedules itself — so this is the one place that knows the cadence.
//
// Relative imports and no "server-only": scripts/gtm-schedule.mjs runs this under plain Node, outside Next.

// A fixed id, so creating the schedule twice updates the one schedule instead of making a second one that
// scans everything again three hours out of phase.
export const GTM_RADAR_SCHEDULE_ID = "gtm-radar-scan";
export const GTM_RADAR_JOB_PATH = "/api/jobs/gtm-radar";

// Every 3 hours on the hour (GTM_LIMITS.radarIntervalHours).
export function getGtmRadarCron() {
	return `0 */${GTM_LIMITS.radarIntervalHours} * * *`;
}

export function getGtmRadarUrl() {
	return `${getAppUrl()}${GTM_RADAR_JOB_PATH}`;
}

// Its own client rather than lib/sending.js's: that module pulls in SES and the whole campaign send path,
// and the GTM agent is meant to be removable without touching it. Same token, same guard.
let qstash;

function getGtmQStash() {
	if (!process.env.QSTASH_TOKEN) throw new Error("QStash is not configured (QSTASH_TOKEN)");
	qstash ??= new Client({ token: process.env.QSTASH_TOKEN });
	return qstash;
}

// QStash can only call a public URL. It would accept localhost and then fail silently every three hours,
// so the default development URL is refused here instead.
export function getScheduleProblem(url = getGtmRadarUrl()) {
	const { hostname, protocol } = new URL(url);
	if (!["http:", "https:"].includes(protocol)) return `${url} is not an HTTP URL`;
	// URL keeps the brackets on an IPv6 host, so the loopback arrives here as "[::1]".
	if (["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(hostname)) {
		return `APP_URL points at ${hostname}, which QStash can't reach: set it to this deployment's public URL`;
	}
	return null;
}

// Creates the schedule, or updates it when it already exists. A deploy-time step, not something a page can
// trigger: it points QStash at a public URL and there is exactly one schedule per environment.
export async function createGtmRadarSchedule() {
	const destination = getGtmRadarUrl();
	const problem = getScheduleProblem(destination);
	if (problem) throw new Error(problem);

	const cron = getGtmRadarCron();
	const { scheduleId } = await getGtmQStash().schedules.create({
		scheduleId: GTM_RADAR_SCHEDULE_ID,
		destination,
		cron,
		body: JSON.stringify({ source: "schedule" }),
		headers: { "Content-Type": "application/json" },
		// A missed scan is picked up by the next one three hours later, so one retry is enough.
		retries: 1,
	});
	return { scheduleId, destination, cron };
}

export async function getGtmRadarSchedule() {
	const schedules = await getGtmQStash().schedules.list();
	return schedules.find((schedule) => schedule.scheduleId === GTM_RADAR_SCHEDULE_ID) ?? null;
}

export async function removeGtmRadarSchedule() {
	await getGtmQStash().schedules.delete(GTM_RADAR_SCHEDULE_ID);
	return { scheduleId: GTM_RADAR_SCHEDULE_ID, removed: true };
}
