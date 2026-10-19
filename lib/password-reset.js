import "server-only";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { buildPasswordResetEmail } from "@/lib/password-reset-email";
import { hashPassword } from "@/lib/passwords";
import { getPasswordProblem } from "@/lib/passwords-rules";
import { sendSesEmail } from "@/lib/ses";
import { createResetToken, getResetExpiry, hashResetToken, looksLikeResetToken, normalizeLoginEmail } from "@/lib/session-rules";
import User from "@/models/User";

// Resets go out from the platform's own address; ALERT_FROM is the fallback so a fresh install needs one setting.
function getFromAddress() {
	return process.env.PLATFORM_FROM || process.env.ALERT_FROM || "";
}

// Never says whether the address has an account: the caller shows the same answer either way.
export async function requestPasswordReset(email) {
	const normalized = normalizeLoginEmail(email);
	if (!normalized) return;
	await connectDb();
	const user = await User.findOne({ email: normalized, disabledAt: null }).select({ email: 1, name: 1 }).lean();
	if (!user) return;

	const from = getFromAddress();
	if (!from || !isSendingEnabled()) {
		console.warn("[auth] Password reset asked for, but no email can be sent: set PLATFORM_FROM (or ALERT_FROM) and SENDING_ENABLED=true");
		return;
	}

	const { token, tokenHash } = createResetToken();
	await User.updateOne({ _id: user._id }, { $set: { passwordReset: { tokenHash, expiresAt: getResetExpiry(), requestedAt: new Date() } } });
	const { subject, text, html } = buildPasswordResetEmail({ url: `${getAppUrl()}/reset-password?token=${token}`, name: user.name });
	await sendSesEmail({ from, to: user.email, subject, text, html });
}

// One use only: the update that checks the token also removes it, so two clicks can't both win.
// A new password signs the person out everywhere.
export async function resetPassword(token, password) {
	if (!looksLikeResetToken(token)) return { error: "This link isn't valid. Ask for a new one." };
	const problem = getPasswordProblem(password);
	if (problem) return { error: problem };

	await connectDb();
	const user = await User.findOneAndUpdate(
		{ "passwordReset.tokenHash": hashResetToken(token), "passwordReset.expiresAt": { $gt: new Date() }, disabledAt: null },
		{ $set: { passwordHash: await hashPassword(password) }, $inc: { sessionVersion: 1 }, $unset: { passwordReset: 1 } },
		{ new: true }
	).select({ email: 1 });
	if (!user) return { error: "This link has expired or was already used. Ask for a new one." };
	return { ok: true };
}
