import "server-only";
import { filterImportRows } from "@/lib/address-check";
import { importContactRows } from "@/lib/contact-import";
import { sanitizeImportRow } from "@/lib/csv-import";

// Rows that record that someone left are kept whatever their domain: they exist to stop mail going to them.
const LEAVER_STATUSES = new Set(["unsubscribed", "bounced", "complained"]);

// importContactRows, after dropping addresses that are typos, throwaway inboxes, on the platform's blocklist or on
// a domain that can't receive email. The result counts what was dropped, by reason.
export async function importCheckedRows({ rows, ...options }) {
	const clean = rows.map(sanitizeImportRow).filter(Boolean);
	const { accepted, rejected, rejectedCount } = await filterImportRows(clean, { isExempt: ({ status }) => LEAVER_STATUSES.has(status) });
	const result = await importContactRows({ ...options, rows: accepted });
	return { ...result, invalid: result.invalid + (rows.length - clean.length), rejected, rejectedCount };
}
