"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { notifyActivity } from "@/lib/alerts";
import { authenticate, startSession } from "@/lib/auth";
import { getConfigProblems } from "@/lib/config";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { normalizeLoginEmail } from "@/lib/session-rules";

const ATTEMPTS_PER_IP = { name: "login-ip", limit: 10, window: "15 m" };
// Guessing one account from many addresses is stopped here.
const ATTEMPTS_PER_EMAIL = { name: "login-email", limit: 10, window: "15 m" };

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

	await startSession(user);
	await notifyActivity([`New login: ${user.email}`], { withUserAgent: true });
	redirect(safeNextPath(formData.get("next")));
}
