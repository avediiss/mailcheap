"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { withEngagement } from "@/lib/cleanup";
import { getErasedEmail, getSuppressionReasonOnDelete } from "@/lib/contact-delete";
import { checkAddress } from "@/lib/address-check";
import { listContactFields } from "@/lib/contact-fields-server";
import { readFieldDefinition, readFieldValues } from "@/lib/contact-fields";
import { importCheckedRows } from "@/lib/contact-import-checked";
import { MAX_IMPORT_ROWS_PER_REQUEST, normalizeTags } from "@/lib/csv-import";
import { connectDb } from "@/lib/db";
import { toFirstName } from "@/lib/merge-tags";
import { normalizeEmail } from "@/lib/validation";
import { CONTACT_LIMIT_MESSAGE, getContactRoomFor } from "@/lib/quota";
import { MAX_SEGMENTS_PER_NEWSLETTER, readSegment } from "@/lib/segments";
import { countRules } from "@/lib/segments-server";
import { requireWorkspace } from "@/lib/workspace";
import { getSuppressionScope } from "@/lib/workspace-rules";
import Contact from "@/models/Contact";
import ContactField from "@/models/ContactField";
import Event from "@/models/Event";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Segment from "@/models/Segment";
import Suppression from "@/models/Suppression";

// The newsletter must belong to the signed-in person's workspace; its workspaceId then goes on every contact.
async function findOwnNewsletter(workspaceId, newsletterId) {
	if (!isValidObjectId(newsletterId)) return null;
	return Newsletter.findOne({ _id: newsletterId, workspaceId }).select({ _id: 1, workspaceId: 1 }).lean();
}

export async function importContacts({ newsletterId, rows }) {
	const { workspaceId } = await requireWorkspace();
	if (!Array.isArray(rows) || rows.length > MAX_IMPORT_ROWS_PER_REQUEST) return { error: "Too many rows" };

	await connectDb();
	const newsletter = await findOwnNewsletter(workspaceId, newsletterId);
	if (!newsletter) return { error: "Newsletter not found" };

	const { room } = await getContactRoomFor(workspaceId);
	const result = await importCheckedRows({ workspaceId, newsletterId: newsletter._id, rows, room });
	revalidatePath("/contacts");
	return result;
}

// Adds one contact by hand. It goes through the same import rules as a CSV row, so an address that
// unsubscribed, bounced or complained keeps that status and is not re-added.
export async function addContact({ newsletterId, email, firstName, tags }) {
	const { workspaceId } = await requireWorkspace();
	const normalized = normalizeEmail(email);
	if (!normalized) return { error: "Enter a valid email address" };

	await connectDb();
	const newsletter = await findOwnNewsletter(workspaceId, newsletterId);
	if (!newsletter) return { error: "Newsletter not found" };

	// One address typed by hand: say exactly what is wrong with it, and offer the fix for a typo.
	const problem = await checkAddress(normalized);
	if (problem) return { error: problem.message };

	const { room } = await getContactRoomFor(workspaceId);
	const { created, skippedOverLimit } = await importCheckedRows({
		workspaceId,
		newsletterId: newsletter._id,
		room,
		rows: [{ email: normalized, status: "active", firstName, tags }],
		source: "manual",
	});
	if (skippedOverLimit > 0) return { error: CONTACT_LIMIT_MESSAGE };
	const contact = await Contact.findOne({ workspaceId, newsletterId: newsletter._id, email: normalized }).select({ status: 1 }).lean();
	revalidatePath("/contacts");
	return { email: normalized, created: created > 0, status: contact?.status };
}

// The Edit dialog: a first name for {{first_name}}, and the tags the campaign's "To" menu sends to. The tags
// replace the old ones, since the dialog shows them all.
export async function updateContact({ id, firstName, tags, fields }) {
	const { workspaceId } = await requireWorkspace();
	if (!isValidObjectId(id)) return { error: "Invalid request" };
	const name = toFirstName(firstName);
	const labels = normalizeTags(tags);

	await connectDb();
	// Custom fields are only the ones this workspace defined; an empty value clears the field.
	const parsed = readFieldValues(await listContactFields(workspaceId), fields);
	if (parsed.error) return { error: parsed.error };
	const fieldSet = Object.fromEntries(Object.entries(parsed.values).filter(([, value]) => value !== null).map(([key, value]) => [`fields.${key}`, value]));
	const fieldUnset = Object.fromEntries(Object.entries(parsed.values).filter(([, value]) => value === null).map(([key]) => [`fields.${key}`, 1]));
	const set = { tags: labels, ...(name && { firstName: name }), ...fieldSet };
	const unset = { ...(!name && { firstName: 1 }), ...fieldUnset };
	const { matchedCount } = await Contact.updateOne({ _id: id, workspaceId }, { $set: set, ...(Object.keys(unset).length > 0 && { $unset: unset }) });
	revalidatePath("/contacts");
	return matchedCount ? { ok: true } : { error: "Contact not found" };
}

// Erasure on request. See lib/contact-delete.js for what is removed and what stays.
export async function deleteContact(id) {
	const { workspaceId } = await requireWorkspace();
	if (!isValidObjectId(id)) return { error: "Invalid request" };

	await connectDb();
	const contact = await Contact.findOne({ _id: id, workspaceId }).select({ email: 1, status: 1 }).lean();
	if (!contact) return { error: "Contact not found" };

	const reason = getSuppressionReasonOnDelete(contact.status);
	if (reason) {
		await Suppression.updateOne(
			{ email: contact.email, workspaceId: getSuppressionScope(reason, workspaceId) },
			{ $setOnInsert: { reason, detail: "contact deleted" } },
			{ upsert: true }
		);
	}
	const erasedEmail = getErasedEmail(contact._id);
	await Promise.all([
		Message.updateMany({ contactId: contact._id, workspaceId }, { $set: { email: erasedEmail } }),
		// Only this workspace's events: the same address may be a contact of another workspace too.
		Event.updateMany({ email: contact.email, workspaceId }, { $set: { email: erasedEmail } }),
	]);
	await Contact.deleteOne({ _id: contact._id });
	revalidatePath("/contacts");
	return { ok: true };
}

export async function setContactStatus(id, status) {
	const { workspaceId } = await requireWorkspace();
	if (!isValidObjectId(id) || !["active", "unsubscribed"].includes(status)) {
		return { error: "Invalid request" };
	}
	await connectDb();

	// Reactivation only applies to dormant contacts; unsubscribes, bounces and complaints are final. It
	// starts the list cleanup over, or the next send would make them dormant again.
	const filter =
		status === "active"
			? { _id: id, workspaceId, status: "dormant" }
			: { _id: id, workspaceId, status: { $in: ["active", "dormant", "pending"] } };
	const update =
		status === "active"
			? withEngagement({ $set: { status } })
			: { $set: { status, unsubscribedAt: new Date() } };
	const { modifiedCount } = await Contact.updateOne(filter, update);

	revalidatePath("/contacts");
	return modifiedCount ? { ok: true } : { error: "Status cannot change" };
}

// --- Custom fields ---

export async function createContactField({ label, type }) {
	const { workspaceId } = await requireWorkspace();
	await connectDb();
	const existing = await listContactFields(workspaceId);
	const definition = readFieldDefinition({ label, type }, existing.map(({ key }) => key));
	if (definition.error) return { error: definition.error };
	try {
		await ContactField.create({ workspaceId, ...definition });
	} catch (error) {
		if (error?.code === 11000) return { error: `There is already a field called ${definition.key}` };
		throw error;
	}
	revalidatePath("/contacts");
	return { ok: true, field: definition };
}

// The field and every value of it on every contact. Emails that still use its tag print the fallback.
export async function removeContactField(key) {
	const { workspaceId } = await requireWorkspace();
	await connectDb();
	const { deletedCount } = await ContactField.deleteOne({ workspaceId, key: String(key ?? "") });
	if (!deletedCount) return { error: "Field not found" };
	await Contact.updateMany({ workspaceId, [`fields.${key}`]: { $exists: true } }, { $unset: { [`fields.${key}`]: 1 } });
	revalidatePath("/contacts");
	return { ok: true };
}

// --- Saved segments ---

async function readOwnSegment(workspaceId, input) {
	const newsletter = await findOwnNewsletter(workspaceId, input?.newsletterId);
	if (!newsletter) return { error: "Newsletter not found" };
	const parsed = readSegment(input, await listContactFields(workspaceId));
	return parsed.error ? parsed : { newsletter, segment: parsed };
}

// How many active contacts the rules pick right now, before saving.
export async function countSegmentRules(input) {
	const { workspaceId } = await requireWorkspace();
	await connectDb();
	const result = await readOwnSegment(workspaceId, { name: "Preview", ...input });
	if (result.error) return { error: result.error };
	return { count: await countRules({ workspaceId, newsletterId: result.newsletter._id, segment: result.segment }) };
}

// Creates a segment, or changes the one with `id`.
export async function saveSegment(input) {
	const { workspaceId } = await requireWorkspace();
	await connectDb();
	const result = await readOwnSegment(workspaceId, input);
	if (result.error) return { error: result.error };
	const { newsletter, segment } = result;

	if (input.id) {
		if (!isValidObjectId(input.id)) return { error: "Segment not found" };
		const { matchedCount } = await Segment.updateOne({ _id: input.id, workspaceId, newsletterId: newsletter._id }, { $set: segment });
		if (!matchedCount) return { error: "Segment not found" };
	} else {
		if ((await Segment.countDocuments({ workspaceId, newsletterId: newsletter._id })) >= MAX_SEGMENTS_PER_NEWSLETTER) {
			return { error: `A newsletter can have ${MAX_SEGMENTS_PER_NEWSLETTER} segments` };
		}
		await Segment.create({ workspaceId, newsletterId: newsletter._id, ...segment });
	}
	revalidatePath("/contacts");
	return { ok: true };
}

// Issues that were going to this segment are asked to choose again (they won't be sent to everyone).
export async function removeSegment(id) {
	const { workspaceId } = await requireWorkspace();
	if (!isValidObjectId(id)) return { error: "Segment not found" };
	await connectDb();
	const { deletedCount } = await Segment.deleteOne({ _id: id, workspaceId });
	if (!deletedCount) return { error: "Segment not found" };
	revalidatePath("/contacts");
	return { ok: true };
}
