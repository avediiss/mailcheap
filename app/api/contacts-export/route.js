import { getSession } from "@/lib/auth";
import { buildContactFilters, readContactFilters } from "@/lib/contact-filter";
import { CSV_HEADER_LINE, contactToCsvLine } from "@/lib/contacts-csv";
import { connectDb } from "@/lib/db";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

export const dynamic = "force-dynamic";

// The contacts list as a CSV file, with the page's own filters (?newsletter=&status=&q=). One line at a
// time from the database, so a long list never sits in memory. The proxy already needs a session for
// /api/*; this checks again because it hands out every address.
export async function GET(request) {
	if (!(await getSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { filter } = buildContactFilters(readContactFilters(new URL(request.url).searchParams));
	await connectDb();
	const newsletters = await Newsletter.find().select({ name: 1 }).lean();
	const names = new Map(newsletters.map(({ _id, name }) => [String(_id), name]));
	const cursor = Contact.find(filter).sort({ _id: 1 }).lean().cursor();

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			// The byte order mark makes Excel read accented names as UTF-8.
			controller.enqueue(encoder.encode(`﻿${CSV_HEADER_LINE}\r\n`));
			try {
				for await (const contact of cursor) {
					const line = contactToCsvLine(contact, names.get(String(contact.newsletterId)));
					controller.enqueue(encoder.encode(`${line}\r\n`));
				}
				controller.close();
			} catch (error) {
				console.error("[contacts-export] Failed:", error);
				controller.error(error);
			}
		},
		async cancel() {
			await cursor.close();
		},
	});

	const day = new Date().toISOString().slice(0, 10);
	return new Response(stream, {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="contacts-${day}.csv"`,
			"Cache-Control": "no-store",
		},
	});
}
