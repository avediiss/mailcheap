// Who an alert goes to. "platform": the platform owner (ADMIN_EMAIL), as before. "owners": the owners of
// the workspace it's about, for things only they should see (new subscriber emails). "owners+platform":
// both, for things that affect the shared sending reputation (a paused send, a spam complaint).
export const ALERT_AUDIENCES = ["platform", "owners", "owners+platform"];

// Unique addresses, lowercase, never empty.
export function resolveAlertRecipients({ audience = "platform", ownerEmails = [], platformEmail }) {
	const wantsOwners = audience === "owners" || audience === "owners+platform";
	const wantsPlatform = audience === "platform" || audience === "owners+platform";
	const all = [...(wantsOwners ? ownerEmails : []), ...(wantsPlatform ? [platformEmail] : [])]
		.map((email) => String(email ?? "").trim().toLowerCase())
		.filter(Boolean);
	return [...new Set(all)];
}
