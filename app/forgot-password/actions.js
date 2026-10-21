"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { requestPasswordReset } from "@/lib/password-reset";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { normalizeLoginEmail } from "@/lib/session-rules";

const PER_IP = { name: "reset-ip", limit: 5, window: "15 m" };
const PER_EMAIL = { name: "reset-email", limit: 3, window: "1 h" };

// The same answer for every address, so the form can't be used to find out who has an account.
export async function forgotPassword(_state, formData) {
	const email = normalizeLoginEmail(formData.get("email"));
	if (!email.includes("@")) return { error: "Enter your email address" };

	const ip = getClientIp(await headers());
	if ((await isRateLimited({ ...PER_IP, key: ip })) || (await isRateLimited({ ...PER_EMAIL, key: email }))) {
		return { error: "Too many requests. Try again later." };
	}

	// After the response, so how long it takes doesn't show whether the account exists.
	after(() => requestPasswordReset(email).catch((error) => console.error("[auth] Password reset failed:", error.message)));
	return { ok: true };
}
