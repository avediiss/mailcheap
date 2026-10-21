import { APP_NAME } from "./config.js";

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// Plain on purpose, like the reset email: an invitation is a utility message.
export function buildInvitationEmail({ url, workspaceName, inviterName, role, days = 7 }) {
	const who = inviterName ? `${inviterName} invited you` : "You were invited";
	const roleText = role === "owner" ? "an owner" : "an editor";
	const subject = `${inviterName || "Someone"} invited you to ${workspaceName} on ${APP_NAME}`;
	const text = `${who} to join "${workspaceName}" as ${roleText}.\n\nAccept the invitation here (the link works for ${days} days):\n\n${url}\n\nIf you weren't expecting this, you can ignore this email.\n`;
	const html = `<p>${escapeHtml(who)} to join <strong>${escapeHtml(workspaceName)}</strong> as ${roleText}.</p><p><a href="${escapeHtml(url)}">Accept the invitation</a></p><p style="color:#666">The link works for ${days} days. If you weren't expecting this, you can ignore this email.</p>`;
	return { subject, text, html };
}
