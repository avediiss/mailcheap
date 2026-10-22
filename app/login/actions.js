"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { notifyActivity } from "@/lib/alerts";
import { authenticate, startSession } from "@/lib/auth";
import { getConfigProblems } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { isSessionCurrent, normalizeLoginEmail } from "@/lib/session-rules";
import { CHALLENGE_COOKIE, CHALLENGE_MAX_AGE, signChallengeToken, verifyChallengeToken } from "@/lib/session-token";
import { hasTwoFactor, verifySecondFactor } from "@/lib/two-factor";
import User from "@/models/User";

const ATTEMPTS_PER_IP = { name: "login-ip", limit: 10, window: "15 m" };
// Guessing one account from many addresses is stopped here.
const ATTEMPTS_PER_EMAIL = { name: "login-email", limit: 10, window: "15 m" };
// Six digits are guessable in time, so the second step is limited harder, per person and per address.
const CODE_TRIES_PER_USER = { name: "login-2fa-user", limit: 5, window: "15 m" };
const CODE_TRIES_PER_IP = { name: "login-2fa-ip", limit: 20, window: "15 m" };

const CHALLENGE_OPTIONS = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" };

function safeNextPath(value) {
	return typeof value === "string" && /^\/(?!\/)[\w\-/]*$/.test(value) ? value : "/";
}

export async function login(_state, formData) {
	const problems = getConfigProblems();
	if (problems.length > 0) return { error: `Login is off until the server's settings are fixed. ${problems.join(" ")}` };

	if (await isRateLimited({ ...ATTEMPTS_PER_IP, key: getClientIp(await headers()) })) {
		return { error: "Too many attempts. Try again in 15 minutes." };
	}

	const email = normalizeLoginEmail(formData.get("email"));
	const password = formData.get("password");
	if (email && (await isRateLimited({ ...ATTEMPTS_PER_EMAIL, key: email }))) {
		return { error: "Too many attempts. Try again in 15 minutes." };
	}

	const user = await authenticate(email, password);
	if (!user) {
		// Slow down guessing.
		await new Promise((resolve) => setTimeout(resolve, 800));
		return { error: "Wrong email or password" };
	}

	const next = safeNextPath(formData.get("next"));
	// Right password, but the account has a second factor: nothing is logged in until that is proven too.
	if (hasTwoFactor(user)) {
		const store = await cookies();
		store.set(CHALLENGE_COOKIE, await signChallengeToken({ userId: user._id, sessionVersion: user.sessionVersion ?? 0, next }), { ...CHALLENGE_OPTIONS, maxAge: CHALLENGE_MAX_AGE });
		redirect("/login/verify");
	}
	await startSession(user);
	await notifyActivity([`New login: ${user.email}`], { withUserAgent: true });
	redirect(next);
}

// The second step: an app code or a recovery code, for the person whose password was just accepted.
export async function verifyLogin(_state, formData) {
	const store = await cookies();
	const challenge = await verifyChallengeToken(store.get(CHALLENGE_COOKIE)?.value);
	if (!challenge) return { error: "This step expired. Log in again.", expired: true };

	if (await isRateLimited({ ...CODE_TRIES_PER_IP, key: getClientIp(await headers()) }) || (await isRateLimited({ ...CODE_TRIES_PER_USER, key: challenge.userId }))) {
		return { error: "Too many attempts. Try again in 15 minutes." };
	}

	await connectDb();
	const user = await User.findById(challenge.userId);
	// The password changed or the account was switched off since the first step: start over.
	if (!user || !isSessionCurrent(user, challenge)) {
		store.delete({ name: CHALLENGE_COOKIE, ...CHALLENGE_OPTIONS });
		return { error: "This step expired. Log in again.", expired: true };
	}

	const result = await verifySecondFactor({ userId: user._id, input: formData.get("code") });
	if (!result.ok) {
		await new Promise((resolve) => setTimeout(resolve, 800));
		return { error: "That code isn't right." };
	}

	store.delete({ name: CHALLENGE_COOKIE, ...CHALLENGE_OPTIONS });
	await startSession(user);
	await notifyActivity([`New login: ${user.email}${result.usedRecovery ? ` (recovery code, ${result.remaining} left)` : ""}`], { withUserAgent: true });
	redirect(safeNextPath(challenge.next));
}
