import mongoose from "mongoose";

export const IMPORT_STATUSES = ["uploading", "queued", "running", "done", "failed"];

// A big contact import (lib/import-jobs.js): the browser uploads the file's rows in chunks, then a background job
// adds them, so closing the window doesn't stop it. The counters are what the contacts page shows as it goes.
const importJobSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		fileName: { type: String, trim: true, maxlength: 200 },
		status: { type: String, enum: IMPORT_STATUSES, default: "uploading" },
		// How many rows the browser says it will send, and how many chunks that is.
		totalRows: { type: Number, required: true, min: 0 },
		chunkCount: { type: Number, required: true, min: 0 },
		uploadedChunks: { type: Number, default: 0 },
		processedChunks: { type: Number, default: 0 },
		processedRows: { type: Number, default: 0 },
		created: { type: Number, default: 0 },
		existing: { type: Number, default: 0 },
		invalid: { type: Number, default: 0 },
		skippedOverLimit: { type: Number, default: 0 },
		fieldProblems: { type: Number, default: 0 },
		rejected: {
			typo: { type: Number, default: 0 },
			disposable: { type: Number, default: 0 },
			blocked: { type: Number, default: 0 },
			undeliverable: { type: Number, default: 0 },
		},
		error: { type: String, maxlength: 300 },
		finishedAt: { type: Date },
	},
	{ timestamps: true }
);

importJobSchema.index({ workspaceId: 1, createdAt: -1 });

export default mongoose.models.ImportJob || mongoose.model("ImportJob", importJobSchema);
