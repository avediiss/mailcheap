import { NextResponse } from "next/server";
import { withQStashSignature } from "@/lib/qstash-route";
import { runSequenceStep } from "@/lib/sequence-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Handled outcomes answer 200 so QStash doesn't retry them; a thrown error (database down, sending
// throttled) is retried. Each outcome is logged: it's the trace of when a series email went out or didn't.
async function handleSequenceStep(request) {
	const body = await request.json().catch(() => null);
	const job = { contactId: body?.contactId, newsletterId: body?.newsletterId, step: body?.step, dueAt: body?.dueAt };
	const result = await runSequenceStep(job);
	console.info(`[sequence] ${JSON.stringify({ ...job, ...result })}`);
	return NextResponse.json(result);
}

export const POST = withQStashSignature(handleSequenceStep);
