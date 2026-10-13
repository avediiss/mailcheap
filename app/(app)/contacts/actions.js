"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { withEngagement } from "@/lib/cleanup";
import { importContactRows } from "@/lib/contact-import";
import { MAX_IMPORT_ROWS_PER_REQUEST } from "@/lib/csv-import";
import { connectDb } from "@/lib/db";
import { normalizeEmail } from "@/lib/validation";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

export async function importContacts({ newsletterId, rows }) {
	await requireSession();
	if (!isValidObjectId(newsletterId)) return { error: "Newsletter not found" };
	if (!Array.isArray(rows) || rows.length > MAX_IMPORT_ROWS_PER_REQUEST) return { error: "Too many rows" };

	await connectDb();
	if (!(await Newsletter.exists({ _id: newsletterId }))) return { error: "Newsletter not found" };

	const result = await importContactRows({ newsletterId, rows });
	revalidatePath("/contacts");
	return result;
}

// Adds one contact by hand. It goes through the same import rules as a CSV row, so an address that
// unsubscribed, bounced or complained keeps that status and is not re-added.
export async function addContact({ newsletterId, email }) {
	await requireSession();
	if (!isValidObjectId(newsletterId)) return { error: "Newsletter not found" };
	const normalized = normalizeEmail(email);
	if (!normalized) return { error: "Enter a valid email address" };

	await connectDb();
	if (!(await Newsletter.exists({ _id: newsletterId }))) return { error: "Newsletter not found" };

	const { created } = await importContactRows({
		newsletterId,
		rows: [{ email: normalized, status: "active" }],
		source: "manual",
	});
	const contact = await Contact.findOne({ newsletterId, email: normalized }).select({ status: 1 }).lean();
	revalidatePath("/contacts");
	return { email: normalized, created: created > 0, status: contact?.status };
}

export async function setContactStatus(id, status) {
	await requireSession();
	if (!isValidObjectId(id) || !["active", "unsubscribed"].includes(status)) {
		return { error: "Invalid request" };
	}
	await connectDb();

	// Reactivation only applies to dormant contacts; unsubscribes, bounces and complaints are final. It
	// starts the list cleanup over, or the next send would make them dormant again.
	const filter =
		status === "active"
			? { _id: id, status: "dormant" }
			: { _id: id, status: { $in: ["active", "dormant", "pending"] } };
	const update =
		status === "active"
			? withEngagement({ $set: { status } })
			: { $set: { status, unsubscribedAt: new Date() } };
	const { modifiedCount } = await Contact.updateOne(filter, update);

	revalidatePath("/contacts");
	return modifiedCount ? { ok: true } : { error: "Status cannot change" };
}
