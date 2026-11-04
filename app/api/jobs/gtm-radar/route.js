import { NextResponse } from "next/server";
import { runRadarScan } from "@/lib/gtm/radar-jobs";
import { withQStashSignature } from "@/lib/qstash-route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The three-hourly radar scan (lib/gtm/radar-jobs.js). Like the other job routes: a handled outcome answers
// 200 so QStash doesn't retry it, and a thrown error (database down) is retried. The line it logs is the
// trace of whether the schedule is really firing — this week that is the whole point of the job.
async function handleRadarScan() {
	const result = await runRadarScan();
	console.info(`[gtm radar] ${JSON.stringify(result)}`);
	return NextResponse.json(result);
}

export const POST = withQStashSignature(handleRadarScan);
