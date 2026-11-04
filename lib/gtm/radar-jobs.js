import "server-only";
import { connectDb } from "@/lib/db";
import { isGtmEnabled } from "@/lib/gtm/config";
import GtmProduct from "@/models/gtm/Product";
import GtmWatchedSource from "@/models/gtm/WatchedSource";

// What the scheduled radar scan does when QStash delivers it. Every three hours it will search each watched
// source for posts worth replying to; this week it only reports what it would scan, so the schedule, the
// signature check and the logging can be proved before any searching exists.
// The schedule itself lives in lib/gtm/radar-schedule.js, which scripts/ can import.

export async function runRadarScan({ now = new Date() } = {}) {
	// A handled outcome, not a failure: the schedule can stay in place while the module is switched off,
	// and QStash must not retry it.
	if (!isGtmEnabled()) return { skipped: "the GTM agent is off" };

	await connectDb();
	// What next week's scan will iterate over. Counting it is what makes "it ran" worth logging.
	const [products, sources] = await Promise.all([
		GtmProduct.countDocuments({ onboardingStatus: "ready" }),
		GtmWatchedSource.countDocuments({ active: true }),
	]);

	return { ran: true, at: now.toISOString(), products, sources, searched: 0 };
}
