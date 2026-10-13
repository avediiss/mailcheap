"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { withEngagement } from "@/lib/cleanup";
import { getErasedEmail, getSuppressionReasonOnDelete } from "@/lib/contact-delete";
import { importContactRows } from "@/lib/contact-import";
import { MAX_IMPORT_ROWS_PER_REQUEST, normalizeTags } from "@/lib/csv-import";
import { connectDb } from "@/lib/db";
import { toFirstName } from "@/lib/merge-tags";
import { normalizeEmail } from "@/lib/validation";
import Contact from "@/models/Contact";
import Event from "@/models/Event";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Suppression from "@/models/Suppression";

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
export async function addContact({ newsletterId, email, firstName, tags }) {
	await requireSession();
	if (!isValidObjectId(newsletterId)) return { error: "Newsletter not found" };
	const normalized = normalizeEmail(email);
	if (!normalized) return { error: "Enter a valid email address" };

	await connectDb();
	if (!(await Newsletter.exists({ _id: newsletterId }))) return { error: "Newsletter not found" };

	const { created } = await importContactRows({
		newsletterId,
		rows: [{ email: normalized, status: "active", firstName, tags }],
		source: "manual",
	});
	const contact = await Contact.findOne({ newsletterId, email: normalized }).select({ status: 1 }).lean();
	revalidatePath("/contacts");
	return { email: normalized, created: created > 0, status: contact?.status };
}

// The Edit dialog: a first name for {{first_name}}, and the tags the campaign's "To" menu sends to. The tags
// replace the old ones, since the dialog shows them all.
export async function updateContact({ id, firstName, tags }) {
	await requireSession();
	if (!isValidObjectId(id)) return { error: "Invalid request" };
	const name = toFirstName(firstName);
	const labels = normalizeTags(tags);

	await connectDb();
	const { matchedCount } = await Contact.updateOne(
		{ _id: id },
		name ? { $set: { firstName: name, tags: labels } } : { $set: { tags: labels }, $unset: { firstName: 1 } }
	);
	revalidatePath("/contacts");
	return matchedCount ? { ok: true } : { error: "Contact not found" };
}

// Erasure on request. See lib/contact-delete.js for what is removed and what stays.
export async function deleteContact(id) {
	await requireSession();
	if (!isValidObjectId(id)) return { error: "Invalid request" };

	await connectDb();
	const contact = await Contact.findById(id).select({ email: 1, status: 1 }).lean();
	if (!contact) return { error: "Contact not found" };

	const reason = getSuppressionReasonOnDelete(contact.status);
	if (reason) {
		await Suppression.updateOne(
			{ email: contact.email },
			{ $setOnInsert: { reason, detail: "contact deleted" } },
			{ upsert: true }
		);
	}
	const erasedEmail = getErasedEmail(contact._id);
	await Promise.all([
		Message.updateMany({ contactId: contact._id }, { $set: { email: erasedEmail } }),
		Event.updateMany({ email: contact.email }, { $set: { email: erasedEmail } }),
	]);
	await Contact.deleteOne({ _id: contact._id });
	revalidatePath("/contacts");
	return { ok: true };
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
