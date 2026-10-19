import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connectDb } from "@/lib/db";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/passwords";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSessionToken, verifySessionToken } from "@/lib/session-token";
import { isEnvAdminLogin, isSessionCurrent, normalizeLoginEmail } from "@/lib/session-rules";
import User from "@/models/User";

// The person for this email and password, or null. Nothing says which of the two was wrong.
export async function authenticate(email, password) {
	const normalized = normalizeLoginEmail(email);
	if (!normalized) return null;
	await connectDb();

	const user = await User.findOne({ email: normalized });
	if (user) {
		const isRight = await verifyPassword(password, user.passwordHash);
		return isRight && !user.disabledAt ? user : null;
	}
	// First start: the owner's ADMIN_EMAIL and ADMIN_PASSWORD create their account, once.
	if (isEnvAdminLogin({ email: normalized, password })) return createPlatformOwner(password);
	await burnPasswordCheck(password);
	return null;
}

async function createPlatformOwner(password) {
	const email = normalizeLoginEmail(process.env.ADMIN_EMAIL);
	try {
		return await User.create({ email, passwordHash: await hashPassword(password), isPlatformAdmin: true });
	} catch (error) {
		// Two first logins at once: the other one made the account, and this password was just checked against the env.
		if (error?.code === 11000) return User.findOne({ email });
		throw error;
	}
}

// Browsers ignore a __Host- cookie, even an expired one, unless it's Secure with Path=/.
const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: process.env.NODE_ENV === "production",
	sameSite: "lax",
	path: "/",
};

export async function startSession(user) {
	await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
	const token = await signSessionToken({ userId: user._id, sessionVersion: user.sessionVersion ?? 0 });
	const store = await cookies();
	store.set(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE });
}

export async function endSession() {
	const store = await cookies();
	store.delete({ name: SESSION_COOKIE, ...COOKIE_OPTIONS });
}

// Signature, then the database: the person must still exist, be enabled, and not have signed out everywhere.
// Once per request, however many pages and actions ask.
export const getSession = cache(async () => {
	const store = await cookies();
	const claims = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
	if (!claims) return null;
	await connectDb();
	const user = await User.findById(claims.userId).select({ email: 1, name: 1, isPlatformAdmin: 1, sessionVersion: 1, disabledAt: 1 }).lean();
	if (!isSessionCurrent(user, claims)) return null;
	return { userId: String(user._id), email: user.email, name: user.name ?? "", isPlatformAdmin: Boolean(user.isPlatformAdmin) };
});

// Server actions run outside proxy.js matching rules, so they re-check the session themselves.
export async function requireSession() {
	const session = await getSession();
	if (!session) redirect("/login");
	return session;
}

export async function requirePlatformAdmin() {
	const session = await requireSession();
	if (!session.isPlatformAdmin) redirect("/");
	return session;
}
