// The contacts export. Opens in Excel, Numbers and Google Sheets, and imports back into Namag.
export const CSV_COLUMNS = [
	"email",
	"first_name",
	"status",
	"newsletter",
	"source",
	"tags",
	"subscribed_at",
	"unsubscribed_at",
	"emails_sent",
	"opens",
	"clicks",
	"last_open_at",
];

// A cell that starts with = + - @ is run as a formula by spreadsheets: a name like "=HYPERLINK(...)" would
// execute on whoever opens the file, so those cells get a leading quote mark.
export function escapeCsvCell(value) {
	let text = value instanceof Date ? value.toISOString() : String(value ?? "");
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// fieldKeys: the workspace's custom fields, as extra columns after the usual ones.
export function getCsvHeaderLine(fieldKeys = []) {
	return [...CSV_COLUMNS, ...fieldKeys].join(",");
}

export function contactToCsvLine(contact, newsletterName = "", fieldKeys = []) {
	return [
		contact.email,
		contact.firstName,
		contact.status,
		newsletterName,
		contact.source,
		(contact.tags ?? []).join(";"),
		contact.subscribedAt,
		contact.unsubscribedAt,
		contact.stats?.sent ?? 0,
		contact.stats?.opens ?? 0,
		contact.stats?.clicks ?? 0,
		contact.lastOpenAt,
		...fieldKeys.map((key) => contact.fields?.[key]),
	]
		.map(escapeCsvCell)
		.join(",");
}

export const CSV_HEADER_LINE = CSV_COLUMNS.join(",");
