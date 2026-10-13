// Subject-line A/B test. A campaign with a second subject (subjectB) splits its recipients between the
// two, alternating down the engagement-sorted list so both get the same mix of readers. Send to a few
// first (the campaign's audience limit), look at the opens, then send the winner to everyone else.

export const VARIANTS = ["A", "B"];
// Under this many delivered emails per subject, a difference in opens is mostly luck.
export const MIN_SAMPLE_PER_VARIANT = 30;
// The leader needs to be this much ahead (in percentage points of open rate) to be called.
export const MIN_LEAD_POINTS = 2;

export function isAbTest(campaign) {
	return Boolean(campaign?.subjectB?.trim());
}

// Once a winner is picked, everyone who is sent after that gets it.
export function assignVariant({ campaign, index, offset = 0 }) {
	if (!isAbTest(campaign)) return null;
	if (VARIANTS.includes(campaign.abWinner)) return campaign.abWinner;
	return VARIANTS[(offset + index) % VARIANTS.length];
}

export function withVariantSubject(campaign, variant) {
	if (variant !== "B" || !isAbTest(campaign)) return campaign;
	return { ...campaign, subject: campaign.subjectB.trim() };
}

function openRate(row) {
	const reached = row.delivered || row.sent;
	return reached ? row.opened / reached : 0;
}

// rows: [{ variant, sent, delivered, opened, clicked }] from the report's aggregation.
export function summarizeVariants(rows = []) {
	return VARIANTS.map((variant) => {
		const row = rows.find((candidate) => candidate.variant === variant) ?? {};
		const summary = { variant, sent: row.sent ?? 0, delivered: row.delivered ?? 0, opened: row.opened ?? 0, clicked: row.clicked ?? 0 };
		return { ...summary, openRate: openRate(summary) };
	});
}

// { leader: "A" | "B" | null, reason: "ready" | "small-sample" | "too-close" }
export function getAbVerdict(summaries) {
	const [a, b] = summaries;
	const smallest = Math.min(a.delivered || a.sent, b.delivered || b.sent);
	if (smallest < MIN_SAMPLE_PER_VARIANT) return { leader: null, reason: "small-sample" };
	const lead = (a.openRate - b.openRate) * 100;
	if (Math.abs(lead) < MIN_LEAD_POINTS) return { leader: null, reason: "too-close" };
	return { leader: lead > 0 ? "A" : "B", reason: "ready" };
}
