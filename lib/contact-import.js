import Contact from "../models/Contact.js";
import Suppression from "../models/Suppression.js";
import { STATUS_RANK, sanitizeImportRow } from "./csv-import.js";
import { getSuppressionScope } from "./workspace-rules.js";

const SUPPRESSION_REASONS = { bounced: "bounce", complained: "complaint" };

function weakerStatuses(status) {
	return Object.keys(STATUS_RANK).filter((key) => STATUS_RANK[key] < STATUS_RANK[status]);
}

// One upsert per contact: new contacts take the file's status, existing ones keep theirs.
export function getContactWrites({ workspaceId, newsletterId, contacts, source }) {
	return contacts.map(({ email, status, subscribedAt, emailsReceived, openRate, clickRate, firstName, tags }) => {
		const imported = Object.entries({ emailsReceived, openRate, clickRate }).filter(
			([, value]) => value !== undefined
		);
		return {
			updateOne: {
				filter: { newsletterId, email },
				update: {
					$setOnInsert: {
						workspaceId,
						status,
						source,
						subscribedAt: subscribedAt ?? new Date(),
						...(firstName && { firstName }),
						...(status === "unsubscribed" && { unsubscribedAt: new Date() }),
					},
					// Tags only ever get added, to new and existing contacts alike.
					...(tags?.length > 0 && { $addToSet: { tags: { $each: tags } } }),
					...(imported.length > 0 && {
						$set: Object.fromEntries(imported.map(([key, value]) => [`imported.${key}`, value])),
					}),
				},
				upsert: true,
			},
		};
	});
}

// Values for custom fields, written after the contacts exist. A value a contact already has is kept: an import
// fills what is empty and never overwrites what someone set by hand. $literal, so a value like "$100" is text and
// not read as a reference to another field.
export function getFieldFillWrites({ newsletterId, contacts }) {
	return contacts
		.filter(({ fields }) => fields && Object.keys(fields).length > 0)
		.map(({ email, fields }) => ({
			updateOne: {
				filter: { newsletterId, email },
				update: [{ $set: { fields: { $mergeObjects: [{ $literal: fields }, { $ifNull: ["$fields", {}] }] } } }],
			},
		}));
}

// The statuses that use up a workspace's contact allowance (the people it can email). Rows that import someone
// as unsubscribed, bounced or complained add nothing to it.
const COUNTED_STATUSES = ["active", "pending", "dormant"];

// With room for only so many new contacts: existing ones are always kept (they take no new room), new ones are
// taken in file order until the room is used, and the rest are left out and counted.
export function limitNewContacts(contacts, existingEmails, room) {
	if (!Number.isFinite(room)) return { accepted: contacts, skipped: 0 };
	let left = Math.max(0, room);
	const accepted = [];
	let skipped = 0;
	for (const contact of contacts) {
		const isNew = !existingEmails.has(contact.email);
		const usesRoom = isNew && COUNTED_STATUSES.includes(contact.status);
		if (!usesRoom) accepted.push(contact);
		else if (left > 0) {
			accepted.push(contact);
			left--;
		} else skipped++;
	}
	return { accepted, skipped };
}

// Each status the rows move existing contacts to, with the weaker statuses it replaces. Nothing moves a
// contact to active, and pending has no rank, so a contact waiting to confirm stays as it is.
export function getStatusChanges(contacts) {
	return Object.entries(Object.groupBy(contacts, ({ status }) => status))
		.filter(([status]) => status !== "active")
		.map(([status, group]) => ({
			status,
			emails: group.map(({ email }) => email),
			replaces: weakerStatuses(status),
		}));
}

// Never deletes and never moves a contact back to a weaker status: an unsubscribe, bounce or
// complaint always wins.
// workspaceId is the newsletter's own: callers read it from the newsletter they have already checked.
export async function importContactRows({ workspaceId, newsletterId, rows, source = "import", room = Number.POSITIVE_INFINITY }) {
	if (!workspaceId) throw new Error("importContactRows needs the newsletter's workspaceId");
	const unique = [...new Map(rows.map(sanitizeImportRow).filter(Boolean).map((row) => [row.email, row])).values()];
	if (unique.length === 0) return { created: 0, existing: 0, invalid: rows.length, skippedOverLimit: 0 };
	const existingEmails = Number.isFinite(room)
		? new Set(await Contact.distinct("email", { newsletterId, email: { $in: unique.map(({ email }) => email) } }))
		: new Set();
	const { accepted: contacts, skipped: skippedOverLimit } = limitNewContacts(unique, existingEmails, room);
	if (contacts.length === 0) return { created: 0, existing: 0, invalid: rows.length - unique.length, skippedOverLimit };

	const result = await Contact.bulkWrite(getContactWrites({ workspaceId, newsletterId, contacts, source }), { ordered: false });

	const fieldWrites = getFieldFillWrites({ newsletterId, contacts });
	if (fieldWrites.length > 0) await Contact.bulkWrite(fieldWrites, { ordered: false });

	const changes = getStatusChanges(contacts);
	for (const { status, emails, replaces } of changes) {
		await Contact.updateMany(
			{ newsletterId, email: { $in: emails }, status: { $in: replaces } },
			{ $set: { status, ...(status === "unsubscribed" && { unsubscribedAt: new Date() }) } }
		);
	}

	const suppressed = changes.filter(({ status }) => SUPPRESSION_REASONS[status]);
	if (suppressed.length > 0) {
		await Suppression.bulkWrite(
			suppressed.flatMap(({ status, emails }) =>
				emails.map((email) => ({
					updateOne: {
						// A bounce suppresses the address everywhere; a complaint, only in this workspace.
						filter: { email, workspaceId: getSuppressionScope(SUPPRESSION_REASONS[status], workspaceId) },
						update: { $setOnInsert: { reason: SUPPRESSION_REASONS[status], detail: source } },
						upsert: true,
					},
				}))
			),
			{ ordered: false }
		);
	}

	return {
		created: result.upsertedCount,
		existing: result.matchedCount,
		invalid: rows.length - unique.length,
		skippedOverLimit,
	};
}
