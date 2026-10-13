// New-subscriber emails: one per signup, but a flood of signups (a bot, a viral post) sends a single
// "many signups" notice instead, so the inbox never fills up.
export const NOTICE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_NOTICES_PER_WINDOW = 5;

// recentSignups: contacts created for this newsletter in the last window, including this one.
export function getSignupNotice(recentSignups) {
	if (recentSignups <= MAX_NOTICES_PER_WINDOW) return "each";
	if (recentSignups === MAX_NOTICES_PER_WINDOW + 1) return "burst";
	return "none";
}

export function describeSignup({ email, firstName, newsletterName, source }) {
	const name = firstName ? ` (${firstName})` : "";
	const via = source ? ` via ${source}` : "";
	return `${email}${name} subscribed to ${newsletterName}${via}.`;
}
