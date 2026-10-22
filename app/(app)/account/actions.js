"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, requireSession, startSession } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { getPasswordProblem } from "@/lib/passwords-rules";
import { isAdminTwoFactorRequired } from "@/lib/config";
import { isRateLimited } from "@/lib/rate-limit";
import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes } from "@/lib/two-factor";
import User from "@/models/User";

const MAX_NAME_LENGTH = 120;
// Guessing the current password from a stolen session is slowed down.
const PASSWORD_TRIES = { name: "account-password", limit: 5, window: "15 m" };
// Six-digit codes are guessable in time, so every try on the account page counts too.
const CODE_TRIES = { name: "account-2fa", limit: 8, window: "15 m" };

export async function updateProfile(_state, formData) {
	const session = await requireSession();
	const name = String(formData.get("name") ?? "").trim();
	if (name.length > MAX_NAME_LENGTH) return { error: `Keep your name under ${MAX_NAME_LENGTH} characters` };

	await connectDb();
	await User.updateOne({ _id: session.userId }, name ? { $set: { name } } : { $unset: { name: 1 } });
	revalidatePath("/", "layout");
	return { ok: true };
}

// A new password signs out every other device. This one stays signed in: its cookie is re-issued.
export async function changePassword(_state, formData) {
	const session = await requireSession();
	const current = String(formData.get("current") ?? "");
	const password = String(formData.get("password") ?? "");
	if (password !== String(formData.get("confirm") ?? "")) return { error: "The two new passwords don't match." };
	const problem = getPasswordProblem(password);
	if (problem) return { error: problem };
	if (await isRateLimited({ ...PASSWORD_TRIES, key: session.userId })) return { error: "Too many attempts. Try again in 15 minutes." };

	await connectDb();
	const user = await User.findById(session.userId);
	if (!user || !(await verifyPassword(current, user.passwordHash))) return { error: "Your current password is wrong." };
	if (current === password) return { error: "Pick a password you haven't used." };

	user.passwordHash = await hashPassword(password);
	user.sessionVersion = (user.sessionVersion ?? 0) + 1;
	user.passwordReset = undefined;
	await user.save();
	await startSession(user, { touchLogin: false });
	return { ok: true };
}

// Every device, this one included: the sign-out number goes up, so every cookie issued before stops working.
export async function signOutEverywhere() {
	const session = await requireSession();
	await connectDb();
	await User.updateOne({ _id: session.userId }, { $inc: { sessionVersion: 1 } });
	await endSession();
	redirect("/login");
}

// --- Two-factor login ---

export async function startTwoFactorSetup() {
	const session = await requireSession();
	const result = await beginTwoFactorSetup(session.userId);
	return result.error ? { error: result.error } : { ok: true, secret: result.secret, qr: result.qr };
}

export async function finishTwoFactorSetup(_state, formData) {
	const session = await requireSession();
	if (await isRateLimited({ ...CODE_TRIES, key: session.userId })) return { error: "Too many attempts. Try again in 15 minutes." };
	const result = await confirmTwoFactorSetup({ userId: session.userId, code: formData.get("code") });
	if (result.error) return { error: result.error, expired: result.expired };
	revalidatePath("/", "layout");
	return { ok: true, recoveryCodes: result.recoveryCodes };
}

export async function newRecoveryCodes(_state, formData) {
	const session = await requireSession();
	if (await isRateLimited({ ...CODE_TRIES, key: session.userId })) return { error: "Too many attempts. Try again in 15 minutes." };
	const result = await regenerateRecoveryCodes({ userId: session.userId, code: formData.get("code") });
	if (result.error) return { error: result.error };
	revalidatePath("/account");
	return { ok: true, recoveryCodes: result.recoveryCodes };
}

export async function turnOffTwoFactor(_state, formData) {
	const session = await requireSession();
	// An administrator who could switch it off would make the requirement mean nothing.
	if (session.isPlatformAdmin && isAdminTwoFactorRequired()) return { error: "Platform administrators must keep two-factor login on." };
	if (await isRateLimited({ ...CODE_TRIES, key: session.userId })) return { error: "Too many attempts. Try again in 15 minutes." };
	const result = await disableTwoFactor({ userId: session.userId, password: formData.get("password"), code: formData.get("code") });
	if (result.error) return { error: result.error };
	revalidatePath("/", "layout");
	return { ok: true };
}
