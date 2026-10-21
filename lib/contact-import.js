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
export async function importContactRows({ workspaceId, newsletterId, rows, source = "import" }) {
	if (!workspaceId) throw new Error("importContactRows needs the newsletter's workspaceId");
	const contacts = [
		...new Map(rows.map(sanitizeImportRow).filter(Boolean).map((row) => [row.email, row])).values(),
	];
	if (contacts.length === 0) return { created: 0, existing: 0, invalid: rows.length };

	const result = await Contact.bulkWrite(getContactWrites({ workspaceId, newsletterId, contacts, source }), { ordered: false });

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
		invalid: rows.length - contacts.length,
	};
}
