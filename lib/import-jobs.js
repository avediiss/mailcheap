import "server-only";
import { isValidObjectId } from "mongoose";
import { sendAlert } from "@/lib/alerts";
import { getAppUrl } from "@/lib/config";
import { importCheckedRows } from "@/lib/contact-import-checked";
import { connectDb } from "@/lib/db";
import { MAX_IMPORT_ROWS_PER_REQUEST, sanitizeImportRow } from "@/lib/csv-import";
import { getContactRoomFor } from "@/lib/quota";
import { getQStash } from "@/lib/sending";
import ImportChunk from "@/models/ImportChunk";
import ImportJob from "@/models/ImportJob";
import Newsletter from "@/models/Newsletter";

// Up to this many rows in one file. The browser sends them a few hundred at a time; a background job adds them.
export const MAX_IMPORT_ROWS = 250_000;
export const IMPORT_CHUNK_ROWS = 500;
// A job stops and hands over to a fresh one before the platform's own time limit for a request.
const RUN_BUDGET_MS = 200_000;
const ACTIVE_STATUSES = ["uploading", "queued", "running"];
// An upload that stopped (the window was closed half way) is given up on after this long.
const STALE_UPLOAD_MS = 60 * 60_000;

const asId = (value) => (isValidObjectId(value) ? String(value) : null);

// Begins an import: one at a time per workspace, since the contact limit and the order of rows depend on it.
export async function startImportJob({ workspaceId, userId, newsletterId, fileName, totalRows }) {
	await connectDb();
	const total = Number(totalRows);
	if (!Number.isInteger(total) || total < 1) return { error: "The file has no rows to import" };
	if (total > MAX_IMPORT_ROWS) return { error: `A file can have up to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows. Split it and import the parts.` };
	const newsletter = asId(newsletterId) && (await Newsletter.findOne({ _id: newsletterId, workspaceId }).select({ _id: 1 }).lean());
	if (!newsletter) return { error: "Newsletter not found" };

	// An upload nobody finished doesn't hold the door shut.
	await ImportJob.updateMany({ workspaceId, status: "uploading", updatedAt: { $lt: new Date(Date.now() - STALE_UPLOAD_MS) } }, { $set: { status: "failed", error: "The upload was never finished", finishedAt: new Date() } });
	if (await ImportJob.exists({ workspaceId, status: { $in: ACTIVE_STATUSES } })) {
		return { error: "Another import is still going. Wait for it to finish, then start this one." };
	}
	const job = await ImportJob.create({
		workspaceId,
		newsletterId: newsletter._id,
		createdBy: userId,
		fileName: String(fileName ?? "").slice(0, 200),
		totalRows: total,
		chunkCount: Math.ceil(total / IMPORT_CHUNK_ROWS),
	});
	return { ok: true, jobId: String(job._id), chunkRows: IMPORT_CHUNK_ROWS };
}

// One piece of the file. Sent again, a piece replaces itself, so a retried request is harmless.
export async function saveImportChunk({ workspaceId, jobId, index, rows }) {
	await connectDb();
	const job = await ImportJob.findOne({ _id: asId(jobId), workspaceId, status: "uploading" });
	if (!job) return { error: "This import isn't accepting rows anymore" };
	if (!Number.isInteger(index) || index < 0 || index >= job.chunkCount) return { error: "Unexpected part of the file" };
	if (!Array.isArray(rows) || rows.length === 0 || rows.length > Math.min(IMPORT_CHUNK_ROWS, MAX_IMPORT_ROWS_PER_REQUEST)) return { error: "Too many rows in one part" };

	// Rows come from the browser: each is checked again here, and the ones that can't be used are counted.
	const clean = rows.map(sanitizeImportRow).filter(Boolean);
	const { upsertedCount, matchedCount } = await ImportChunk.updateOne({ jobId: job._id, index }, { $set: { rows: clean } }, { upsert: true });
	// A part sent twice must not count twice.
	const isNew = upsertedCount > 0 || matchedCount === 0;
	await ImportJob.updateOne(
		{ _id: job._id },
		{ $inc: { ...(isNew && { uploadedChunks: 1, invalid: rows.length - clean.length }) }, $set: { updatedAt: new Date() } }
	);
	return { ok: true };
}

// All parts are here: hand the job to the background. Without QStash (local development) it runs right away.
export async function finishImportUpload({ workspaceId, jobId }) {
	await connectDb();
	const job = await ImportJob.findOneAndUpdate({ _id: asId(jobId), workspaceId, status: "uploading", $expr: { $gte: ["$uploadedChunks", "$chunkCount"] } }, { $set: { status: "queued" } }, { new: true });
	if (!job) return { error: "Some parts of the file didn't arrive. Start the import again." };
	await publishImportJob(job._id);
	return { ok: true };
}

export async function publishImportJob(jobId) {
	if (!process.env.QSTASH_TOKEN) {
		// Local development has no queue: run it in this process, after the response.
		setTimeout(() => runImportJob(jobId).catch((error) => console.error("[import] Failed:", error)), 0);
		return;
	}
	await getQStash().publishJSON({ url: `${getAppUrl()}/api/jobs/import`, body: { jobId: String(jobId) } });
}

function isNearlyOutOfTime(startedAt) {
	return Date.now() - startedAt > RUN_BUDGET_MS;
}

// Adds the uploaded rows chunk by chunk, in order. Safe to run twice: a part already added is gone, and adding a
// contact again changes nothing. Past its time budget it hands over to a new run of itself.
export async function runImportJob(jobId) {
	await connectDb();
	const startedAt = Date.now();
	let job = await ImportJob.findOneAndUpdate({ _id: asId(jobId), status: { $in: ["queued", "running"] } }, { $set: { status: "running" } }, { new: true });
	if (!job) return { skipped: "not waiting" };

	try {
		while (job.processedChunks < job.chunkCount) {
			if (isNearlyOutOfTime(startedAt)) {
				await publishImportJob(job._id);
				return { handedOver: true };
			}
			const chunk = await ImportChunk.findOne({ jobId: job._id, index: job.processedChunks }).lean();
			// A part that is missing can't be recovered: the rest of the file would be added around a hole.
			if (!chunk) throw new Error(`Part ${job.processedChunks + 1} of the file was lost. Import the file again: nobody is added twice.`);

			const { room } = await getContactRoomFor(job.workspaceId);
			const result = await importCheckedRows({ workspaceId: job.workspaceId, newsletterId: job.newsletterId, rows: chunk.rows, room, source: "import" });
			await ImportChunk.deleteOne({ _id: chunk._id });
			job = await ImportJob.findOneAndUpdate(
				{ _id: job._id },
				{
					$inc: {
						processedChunks: 1,
						processedRows: chunk.rows.length,
						created: result.created,
						existing: result.existing,
						invalid: result.invalid,
						skippedOverLimit: result.skippedOverLimit,
						fieldProblems: result.fieldProblems ?? 0,
						"rejected.typo": result.rejected.typo,
						"rejected.disposable": result.rejected.disposable,
						"rejected.blocked": result.rejected.blocked,
						"rejected.undeliverable": result.rejected.undeliverable,
					},
				},
				{ new: true }
			);
		}
	} catch (error) {
		await ImportJob.updateOne({ _id: job._id }, { $set: { status: "failed", error: String(error.message).slice(0, 300), finishedAt: new Date() } });
		await ImportChunk.deleteMany({ jobId: job._id });
		return { failed: true };
	}

	await ImportJob.updateOne({ _id: job._id }, { $set: { status: "done", finishedAt: new Date() } });
	await sendAlert({
		audience: "owners",
		workspaceId: job.workspaceId,
		key: `import-done-${job._id}`,
		title: "Your import finished",
		detail: `${job.fileName || "Your file"}: ${job.created.toLocaleString("en-US")} added, ${job.existing.toLocaleString("en-US")} already there${job.skippedOverLimit ? `, ${job.skippedOverLimit.toLocaleString("en-US")} not added because of the contact limit` : ""}.`,
		path: "/contacts",
		cooldownMinutes: 1,
	});
	return { done: true };
}

const toStatus = (job) => ({
	id: String(job._id),
	status: job.status,
	fileName: job.fileName,
	totalRows: job.totalRows,
	processedRows: job.processedRows,
	created: job.created,
	existing: job.existing,
	invalid: job.invalid,
	skippedOverLimit: job.skippedOverLimit,
	fieldProblems: job.fieldProblems,
	rejected: { typo: job.rejected?.typo ?? 0, disposable: job.rejected?.disposable ?? 0, blocked: job.rejected?.blocked ?? 0, undeliverable: job.rejected?.undeliverable ?? 0 },
	error: job.error ?? "",
	finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
});

// The import the workspace is running, or the last one that finished in the past day (so its result is seen).
export async function getImportStatus({ workspaceId }) {
	await connectDb();
	const recent = await ImportJob.findOne({
		workspaceId,
		$or: [{ status: { $in: ACTIVE_STATUSES } }, { finishedAt: { $gte: new Date(Date.now() - 24 * 60 * 60_000) } }],
	})
		.sort({ createdAt: -1 })
		.lean();
	return recent ? toStatus(recent) : null;
}
