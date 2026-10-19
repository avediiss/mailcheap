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
