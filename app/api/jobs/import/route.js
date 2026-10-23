import { NextResponse } from "next/server";
import { runImportJob } from "@/lib/import-jobs";
import { withQStashSignature } from "@/lib/qstash-route";
import { isObjectIdString } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Adds a big import's rows to the list. QStash retries a failed request, and the job is safe to run again.
async function handleImport(request) {
	const body = await request.json().catch(() => null);
	if (!isObjectIdString(String(body?.jobId ?? ""))) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
	const result = await runImportJob(body.jobId);
	return NextResponse.json(result);
}

export const POST = withQStashSignature(handleImport);
