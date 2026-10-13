// "Resend to non-openers": a new campaign whose audience is the people an earlier issue reached but who
// neither opened nor clicked it. Opens are counted from the tracking pixel, so they undercount a little
// (images blocked) and Apple Mail's privacy feature counts some opens nobody made: treat it as a nudge,
// not a promise.

export function buildNonOpenersFilter(campaignId) {
	return {
		campaignId,
		kind: "campaign",
		sentAt: { $ne: null },
		status: { $nin: ["bounced", "complained", "failed"] },
		openedAt: null,
		clickedAt: null,
	};
}
