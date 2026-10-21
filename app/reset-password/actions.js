"use server";

import { headers } from "next/headers";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { resetPassword } from "@/lib/password-reset";

const PER_IP = { name: "reset-use-ip", limit: 10, window: "15 m" };

export async function setNewPassword(_state, formData) {
	if (await isRateLimited({ ...PER_IP, key: getClientIp(await headers()) })) {
		return { error: "Too many attempts. Try again later." };
	}
	const password = String(formData.get("password") ?? "");
	if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords don't match." };
	return resetPassword(String(formData.get("token") ?? ""), password);
}
