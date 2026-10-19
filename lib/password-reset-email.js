import { RESET_TOKEN_TTL_MS } from "./session-rules.js";

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// Plain on purpose: a reset email is a utility message, and plain ones reach the inbox.
export function buildPasswordResetEmail({ url, name }) {
	const minutes = Math.round(RESET_TOKEN_TTL_MS / 60_000);
	const greeting = name ? `Hi ${name},` : "Hi,";
	const text = `${greeting}\n\nSomeone asked to reset the password for this account. To choose a new one, open this link within ${minutes} minutes:\n\n${url}\n\nIf it wasn't you, ignore this email: nothing changes unless the link is used.\n`;
	const html = `<p>${escapeHtml(greeting)}</p><p>Someone asked to reset the password for this account. To choose a new one, open this link within ${minutes} minutes:</p><p><a href="${escapeHtml(url)}">Choose a new password</a></p><p style="color:#666">If it wasn't you, ignore this email: nothing changes unless the link is used.</p>`;
	return { subject: "Reset your password", text, html };
}
