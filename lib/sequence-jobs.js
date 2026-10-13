import "server-only";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { getQStash, queueWelcomeEmail, sendSequenceEmail } from "@/lib/sending";
import { getJobWake, getNextStepIndex, getSequenceSteps, getStepDueAt } from "@/lib/sequence";
import { isObjectIdString } from "@/lib/validation";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";
import Suppression from "@/models/Suppression";

// Closer than this to the due time, the email goes out instead of waiting again.
const SEND_EARLY_MS = 60 * 1000;

// One QStash job per contact and step, scheduled one step ahead: the job for step n sends it and then
// schedules step n+1. Nothing is scheduled for the days after the last step, and nothing at all for
// contacts who joined before the series existed.
async function publishSequenceStep({ contactId, newsletterId, step, dueAt, now = Date.now() }) {
	const wakeAt = getJobWake({ dueAt, now });
	await getQStash().publishJSON({
		url: `${getAppUrl()}/api/jobs/send-sequence`,
		body: { contactId: String(contactId), newsletterId: String(newsletterId), step, dueAt: dueAt.toISOString() },
		...(wakeAt.getTime() > now && { notBefore: Math.floor(wakeAt.getTime() / 1000) }),
		// A retried job doesn't schedule its next step twice.
		deduplicationId: `sequence-${contactId}-${step}-${wakeAt.getTime()}`,
	});
}

// Called when someone joins (signs up, or confirms). A no-op when the newsletter has no series.
export async function startWelcomeSeries({ newsletter, contact }) {
	if (!isSendingEnabled() || !process.env.QSTASH_TOKEN) return { skipped: "sending or QStash is off" };
	if (contact?.status !== "active") return { skipped: "contact is not active" };
	const steps = getSequenceSteps(newsletter);
	if (steps.length === 0) return { skipped: "no series" };

	const dueAt = getStepDueAt({ contact, delayDays: steps[0].delayDays });
	await publishSequenceStep({ contactId: contact._id, newsletterId: newsletter._id, step: 0, dueAt });
	return { scheduled: true };
}

// The welcome email, and the series that follows it. Neither blocks the other.
export async function queueWelcomeAndSeries({ newsletter, contact }) {
	const [welcome, series] = await Promise.allSettled([
		queueWelcomeEmail({ newsletter, contact }),
		startWelcomeSeries({ newsletter, contact }),
	]);
	if (series.status === "rejected") {
		console.error(`[sequence] Could not start the series for ${contact._id}:`, series.reason?.message);
	}
	if (welcome.status === "rejected") throw welcome.reason;
	return welcome.value;
}

// Runs when QStash delivers a job. A contact who left, a series switched off, or a step already sent all
// end it quietly, so editing the series never needs to cancel jobs that are already waiting.
export async function runSequenceStep({ contactId, newsletterId, step, dueAt }) {
	const isValid =
		isObjectIdString(String(contactId)) &&
		isObjectIdString(String(newsletterId)) &&
		Number.isInteger(step) &&
		step >= 0 &&
		typeof dueAt === "string" &&
		!Number.isNaN(Date.parse(dueAt));
	if (!isValid) return { skipped: "invalid job" };

	await connectDb();
	const [contact, newsletter] = await Promise.all([
		Contact.findOne({ _id: contactId, newsletterId }).lean(),
		Newsletter.findById(newsletterId).lean(),
	]);
	if (!contact || !newsletter) return { skipped: "contact or newsletter is gone" };
	if (contact.status !== "active") return { skipped: "contact is not active" };
	const steps = getSequenceSteps(newsletter);
	if (!steps[step]) return { skipped: "step is off" };

	const due = new Date(dueAt);
	if (due.getTime() - Date.now() > SEND_EARLY_MS) {
		await publishSequenceStep({ contactId, newsletterId, step, dueAt: due });
		return { waiting: true };
	}
	if (!isSendingEnabled()) throw new Error("Sending is off, retrying later");
	if (await Suppression.exists({ email: contact.email })) return { skipped: "suppressed" };

	const result = await sendSequenceEmail({ newsletter, contact, step });
	// Throttled by SES: the job fails so QStash tries again.
	if (result.retry) throw new Error("Sending was throttled, retrying later");

	const next = getNextStepIndex(steps, step);
	if (next !== null) {
		const nextDue = getStepDueAt({ contact, delayDays: steps[next].delayDays });
		await publishSequenceStep({ contactId, newsletterId, step: next, dueAt: nextDue });
	}
	return { step, ...result, next };
}
