import { LIMITS } from "./config.js";

// Pure rule for blocking a whole workspace. Campaigns pause on their own numbers (sending-rules.js); this looks at
// everything a workspace sent in the last 7 days, because repeated sends just under the campaign limits add up and
// the platform shares one sending account with every client.

// totals: { sent, bounced, complained } over the window. null when the workspace is fine.
export function getAccountBlockReason({ sent = 0, bounced = 0, complained = 0 } = {}) {
	if (!sent) return null;
	const bounceRate = bounced / sent;
	const complaintRate = complained / sent;
	if (bounced >= LIMITS.accountMinBounces && bounceRate > LIMITS.accountBounceRate) {
		return `${(bounceRate * 100).toFixed(1)}% of the last ${LIMITS.accountWindowDays} days' emails bounced (the limit is ${LIMITS.accountBounceRate * 100}%)`;
	}
	if (complained >= LIMITS.accountMinComplaints && complaintRate >= LIMITS.accountComplaintRate) {
		return `${(complaintRate * 100).toFixed(2)}% of the last ${LIMITS.accountWindowDays} days' emails were marked as spam (the limit is ${LIMITS.accountComplaintRate * 100}%)`;
	}
	return null;
}

// The window the numbers are counted over: seven days, or since the platform last cleared the block.
export function getHealthWindowStart({ now = new Date(), healthResetAt } = {}) {
	const sevenDays = new Date(new Date(now).getTime() - LIMITS.accountWindowDays * 24 * 60 * 60 * 1000);
	const reset = healthResetAt ? new Date(healthResetAt) : null;
	return reset && reset > sevenDays ? reset : sevenDays;
}
