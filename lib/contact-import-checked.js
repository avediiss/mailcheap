import "server-only";
import { filterImportRows } from "@/lib/address-check";
import { normalizeFieldValue } from "@/lib/contact-fields";
import { listContactFields } from "@/lib/contact-fields-server";
import { importContactRows } from "@/lib/contact-import";
import { sanitizeImportRow } from "@/lib/csv-import";

// Rows that record that someone left are kept whatever their domain: they exist to stop mail going to them.
const LEAVER_STATUSES = new Set(["unsubscribed", "bounced", "complained"]);

// importContactRows, after dropping addresses that are typos, throwaway inboxes, on the platform's blocklist or on
// a domain that can't receive email. The result counts what was dropped, by reason.
export async function importCheckedRows({ rows, ...options }) {
	const clean = rows.map(sanitizeImportRow).filter(Boolean);
	const { accepted, rejected, rejectedCount } = await filterImportRows(clean, { isExempt: ({ status }) => LEAVER_STATUSES.has(status) });
	const { typed, fieldProblems } = await typeFieldValues(options.workspaceId, accepted);
	const result = await importContactRows({ ...options, rows: typed });
	return { ...result, invalid: result.invalid + (rows.length - clean.length), rejected, rejectedCount, fieldProblems };
}

// A file's text for each custom field becomes what the field holds (a number, a date, text). A value that doesn't fit
// its field, or a field the workspace doesn't have, is left out and counted: the contact is still imported.
async function typeFieldValues(workspaceId, rows) {
	if (!rows.some(({ fields }) => fields)) return { typed: rows, fieldProblems: 0 };
	const definitions = new Map((await listContactFields(workspaceId)).map((definition) => [definition.key, definition]));
	let fieldProblems = 0;
	const typed = rows.map((row) => {
		if (!row.fields) return row;
		const values = {};
		for (const [key, raw] of Object.entries(row.fields)) {
			const parsed = definitions.has(key) ? normalizeFieldValue(definitions.get(key).type, raw) : { error: true };
			if (parsed.error || parsed.value === null) fieldProblems++;
			else values[key] = parsed.value;
		}
		return { ...row, fields: Object.keys(values).length > 0 ? values : undefined };
	});
	return { typed, fieldProblems };
}
