// Nothing here reaches AWS: sends are recorded so a test can see exactly what would have gone out.
export function sentEmails() {
	return (globalThis.__sentEmails ??= []);
}

export function resetSentEmails() {
	globalThis.__sentEmails = [];
}

export async function sendSesEmail(email) {
	sentEmails().push(email);
	return { sesMessageId: `stub-${sentEmails().length}` };
}

export async function listSesDomains() {
	return globalThis.__sesDomains ?? [];
}

export async function getSesAccount() {
	return { productionAccess: true, enforcementStatus: "HEALTHY", sentLast24Hours: 0, max24HourSend: 50000, maxSendRate: 14 };
}

// Domain identities: tests set globalThis.__sesBehavior = { create: "exists" | "denied" | "failed" } to simulate AWS.
export function sesIdentities() {
	return (globalThis.__sesIdentities ??= new Set());
}

export async function createSesDomainIdentity(domain) {
	const behavior = globalThis.__sesBehavior?.create;
	if (behavior) return { error: behavior, detail: "simulated" };
	if (sesIdentities().has(domain)) return { error: "exists" };
	sesIdentities().add(domain);
	return { ok: true };
}

export async function deleteSesDomainIdentity(domain) {
	if (globalThis.__sesBehavior?.delete) return { error: "failed", detail: "simulated" };
	sesIdentities().delete(domain);
	return { ok: true };
}
