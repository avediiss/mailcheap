// Welcome series: a few emails sent automatically after someone joins, each a set number of days after
// they signed up (or confirmed). The first step is "day 1" at the earliest: the welcome email is the
// day-0 message. Pure rules here; the scheduling is in lib/sequence-jobs.js.

export const MAX_STEPS = 5;
export const MIN_DELAY_DAYS = 1;
export const MAX_DELAY_DAYS = 90;
const MAX_SUBJECT_LENGTH = 200;
const MAX_PREVIEW_LENGTH = 300;
const MAX_MARKDOWN_LENGTH = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;
// QStash's free plan delays a message 7 days at most, so a longer wait wakes up on the way (lib/scheduling.js).
export const MAX_WAIT_MS = 6 * DAY_MS;

// Clean list of steps from whatever the settings form sent: only complete steps, in the order they go
// out, at most MAX_STEPS. Rows still empty are dropped, so a blank row in the form is harmless.
export function normalizeSteps(rawSteps) {
	const steps = (Array.isArray(rawSteps) ? rawSteps : [])
		.map((raw) => ({
			delayDays: Number(raw?.delayDays),
			subject: String(raw?.subject ?? "").trim().slice(0, MAX_SUBJECT_LENGTH),
			previewText: String(raw?.previewText ?? "").trim().slice(0, MAX_PREVIEW_LENGTH),
			markdown: String(raw?.markdown ?? "").slice(0, MAX_MARKDOWN_LENGTH),
		}))
		.filter((step) => step.subject && step.markdown.trim());
	return steps
		.map((step) => ({
			...step,
			delayDays: Math.min(MAX_DELAY_DAYS, Math.max(MIN_DELAY_DAYS, Math.round(step.delayDays) || MIN_DELAY_DAYS)),
		}))
		.toSorted((a, b) => a.delayDays - b.delayDays)
		.slice(0, MAX_STEPS);
}

// Why the settings can't be saved, or null. Run on the raw rows, before normalizeSteps drops the empty ones.
export function getSequenceProblem(rawSteps) {
	const rows = Array.isArray(rawSteps) ? rawSteps : [];
	for (const [index, row] of rows.entries()) {
		const hasSubject = Boolean(String(row?.subject ?? "").trim());
		const hasContent = Boolean(String(row?.markdown ?? "").trim());
		if (hasSubject !== hasContent) return `Email ${index + 1} of the series needs both a subject and content`;
		if (!hasSubject) continue;
		const days = Number(row?.delayDays);
		if (!Number.isInteger(days) || days < MIN_DELAY_DAYS || days > MAX_DELAY_DAYS) {
			return `Email ${index + 1} of the series should go out ${MIN_DELAY_DAYS} to ${MAX_DELAY_DAYS} days after signup`;
		}
	}
	if (rows.filter((row) => String(row?.subject ?? "").trim()).length > MAX_STEPS) {
		return `A series has at most ${MAX_STEPS} emails`;
	}
	return null;
}

export function getSequenceSteps(newsletter) {
	return newsletter?.sequence?.enabled ? normalizeSteps(newsletter.sequence.steps) : [];
}

// Same shape as the welcome email's content, so it goes through the same renderer.
export function getSequenceContent(newsletter, step) {
	const found = getSequenceSteps(newsletter)[step];
	if (!found) return null;
	return { format: "markdown", subject: found.subject, markdown: found.markdown, previewText: found.previewText };
}

// Days count from when the person joined: their confirmation if they confirmed, else the signup.
export function getStepDueAt({ contact, delayDays, now = Date.now() }) {
	const joined = new Date(contact?.confirmedAt ?? contact?.subscribedAt ?? now).getTime();
	return new Date(joined + delayDays * DAY_MS);
}

// When a job for this due time should wake up: on time, or after the longest wait QStash allows.
export function getJobWake({ dueAt, now = Date.now() }) {
	return new Date(Math.min(dueAt.getTime(), now + MAX_WAIT_MS));
}

export function getNextStepIndex(steps, step) {
	return step + 1 < steps.length ? step + 1 : null;
}
