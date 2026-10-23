import { buildContactFilters, readContactFilters } from "@/lib/contact-filter";
import { listContactFields } from "@/lib/contact-fields-server";
import { contactToCsvLine, getCsvHeaderLine } from "@/lib/contacts-csv";
import { connectDb } from "@/lib/db";
import Contact from "@/models/Contact";
import { getWorkspaceContext } from "@/lib/workspace";
import Newsletter from "@/models/Newsletter";

export const dynamic = "force-dynamic";

// The contacts list as a CSV file, with the page's own filters (?newsletter=&status=&q=). One line at a
// time from the database, so a long list never sits in memory. The proxy already needs a session for
// /api/*; this checks again because it hands out every address.
export async function GET(request) {
	const context = await getWorkspaceContext();
	if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
	if (!context.workspaceId) return Response.json({ error: "No workspace" }, { status: 403 });

	const { filter } = buildContactFilters({
		workspaceId: context.workspaceId,
		...readContactFilters(new URL(request.url).searchParams),
	});
	await connectDb();
	const newsletters = await Newsletter.find({ workspaceId: context.workspaceId }).select({ name: 1 }).lean();
	const names = new Map(newsletters.map(({ _id, name }) => [String(_id), name]));
	const fieldKeys = (await listContactFields(context.workspaceId)).map(({ key }) => key);
	const cursor = Contact.find(filter).sort({ _id: 1 }).lean().cursor();

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			// The byte order mark makes Excel read accented names as UTF-8.
			controller.enqueue(encoder.encode(`﻿${getCsvHeaderLine(fieldKeys)}\r\n`));
			try {
				for await (const contact of cursor) {
					const line = contactToCsvLine(contact, names.get(String(contact.newsletterId)), fieldKeys);
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
