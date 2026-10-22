import "server-only";
import QRCode from "qrcode";
import { APP_NAME } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { verifyPassword } from "@/lib/passwords";
import { decryptSecret, encryptSecret, hashRecoveryCode } from "@/lib/two-factor-crypto";
import {
	buildOtpauthUri,
	generateRecoveryCodes,
	generateTotpSecret,
	looksLikeRecoveryCode,
	looksLikeTotpCode,
	normalizeRecoveryCode,
	verifyTotp,
} from "@/lib/totp";
import User from "@/models/User";

// A setup that isn't confirmed within this long starts over.
export const PENDING_TTL_MS = 15 * 60_000;

export const hasTwoFactor = (user) => Boolean(user?.twoFactor?.enabledAt);

export function countRecoveryCodes(user) {
	return user?.twoFactor?.recoveryCodes?.length ?? 0;
}

// Step one of setup: a fresh secret, kept (encrypted) but not active until the person proves their app has it.
export async function beginTwoFactorSetup(userId) {
	await connectDb();
	const user = await User.findById(userId).select({ email: 1, twoFactor: 1 });
	if (!user) return { error: "Account not found" };
	if (hasTwoFactor(user)) return { error: "Two-factor login is already on" };

	const secret = generateTotpSecret();
	await User.updateOne({ _id: user._id }, { $set: { "twoFactor.pendingSecret": encryptSecret(secret), "twoFactor.pendingAt": new Date() } });
	const uri = buildOtpauthUri({ secret, email: user.email, issuer: APP_NAME });
	return { ok: true, secret, uri, qr: await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
}

// Step two: the first code from the app turns it on and returns the recovery codes, shown once and never stored in the clear.
export async function confirmTwoFactorSetup({ userId, code }) {
	await connectDb();
	const user = await User.findById(userId).select({ twoFactor: 1 });
	if (!user) return { error: "Account not found" };
	if (hasTwoFactor(user)) return { error: "Two-factor login is already on" };
	const { pendingSecret, pendingAt } = user.twoFactor ?? {};
	if (!pendingSecret || !pendingAt || Date.now() - new Date(pendingAt).getTime() > PENDING_TTL_MS) {
		return { error: "This setup has expired. Start again.", expired: true };
	}
	const secret = decryptSecret(pendingSecret);
	const result = secret ? verifyTotp({ secret, code }) : { ok: false };
	if (!result.ok) return { error: "That code isn't right. Check your app and try the new code." };

	const recoveryCodes = generateRecoveryCodes();
	const { modifiedCount } = await User.updateOne(
		{ _id: user._id, "twoFactor.enabledAt": null },
		{
			$set: {
				"twoFactor.secret": pendingSecret,
				"twoFactor.enabledAt": new Date(),
				"twoFactor.lastUsedStep": result.step,
				"twoFactor.recoveryCodes": recoveryCodes.map((recovery) => hashRecoveryCode(normalizeRecoveryCode(recovery))),
			},
			$unset: { "twoFactor.pendingSecret": 1, "twoFactor.pendingAt": 1 },
		}
	);
	if (!modifiedCount) return { error: "Two-factor login is already on" };
	return { ok: true, recoveryCodes };
}

// The second step of a login, or the proof for a sensitive change: an app code or one recovery code.
// An app code works once (a code seen over a shoulder can't be replayed); a recovery code is used up.
export async function verifySecondFactor({ userId, input, allowRecovery = true }) {
	await connectDb();
	const user = await User.findById(userId).select({ twoFactor: 1 });
	if (!hasTwoFactor(user)) return { ok: false };

	if (looksLikeTotpCode(input)) {
		const secret = decryptSecret(user.twoFactor.secret);
		const result = secret ? verifyTotp({ secret, code: input, lastUsedStep: user.twoFactor.lastUsedStep ?? -1 }) : { ok: false };
		if (!result.ok) return { ok: false };
		// Two requests with the same code at once: only the one that moves the step forward wins.
		const { modifiedCount } = await User.updateOne(
			{ _id: user._id, $or: [{ "twoFactor.lastUsedStep": { $lt: result.step } }, { "twoFactor.lastUsedStep": null }] },
			{ $set: { "twoFactor.lastUsedStep": result.step } }
		);
		return modifiedCount ? { ok: true } : { ok: false };
	}
	if (allowRecovery && looksLikeRecoveryCode(input)) {
		const hash = hashRecoveryCode(normalizeRecoveryCode(input));
		const { modifiedCount } = await User.updateOne({ _id: user._id, "twoFactor.recoveryCodes": hash }, { $pull: { "twoFactor.recoveryCodes": hash } });
		return modifiedCount ? { ok: true, usedRecovery: true, remaining: countRecoveryCodes(user) - 1 } : { ok: false };
	}
	return { ok: false };
}

// Ten new codes replace whatever was left. Needs a current app code, so a stolen session can't mint them.
export async function regenerateRecoveryCodes({ userId, code }) {
	const check = await verifySecondFactor({ userId, input: code, allowRecovery: false });
	if (!check.ok) return { error: "That code isn't right." };
	const recoveryCodes = generateRecoveryCodes();
	await User.updateOne({ _id: userId }, { $set: { "twoFactor.recoveryCodes": recoveryCodes.map((recovery) => hashRecoveryCode(normalizeRecoveryCode(recovery))) } });
	return { ok: true, recoveryCodes };
}

// Turning it off needs both what you know and what you have.
export async function disableTwoFactor({ userId, password, code }) {
	await connectDb();
	const user = await User.findById(userId).select({ passwordHash: 1, twoFactor: 1 });
	if (!hasTwoFactor(user)) return { error: "Two-factor login is already off" };
	if (!(await verifyPassword(String(password ?? ""), user.passwordHash))) return { error: "Your password is wrong." };
	const check = await verifySecondFactor({ userId, input: code });
	if (!check.ok) return { error: "That code isn't right." };
	await User.updateOne({ _id: userId }, { $unset: { twoFactor: 1 } });
	return { ok: true };
}

// A platform administrator removes it from someone who lost their phone and their recovery codes. The person
// is signed out everywhere and sets it up again at their next login.
export async function resetTwoFactor({ actor, userId }) {
	// Removing your own would turn the requirement into a formality; the emergency way is scripts/reset-2fa.mjs.
	if (String(actor?.userId) === String(userId)) return { error: "You can't remove your own here. Another administrator can, or turn it off from the account page if you are not an administrator." };
	await connectDb();
	const user = await User.findById(userId).select({ email: 1, twoFactor: 1 });
	if (!user) return { error: "Account not found" };
	if (!hasTwoFactor(user) && !user.twoFactor?.pendingSecret) return { error: "Two-factor login isn't on for this account" };
	await User.updateOne({ _id: user._id }, { $unset: { twoFactor: 1 }, $inc: { sessionVersion: 1 } });
	await recordAudit({ actor, action: "account.2fa-reset", detail: { email: user.email } });
	return { ok: true };
}
