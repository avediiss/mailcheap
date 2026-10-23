import mongoose from "mongoose";

// A few hundred rows of an import waiting for the background job. Removed as each is added; anything left behind
// (a job that never started) is cleared by the TTL after a week.
const importChunkSchema = new mongoose.Schema(
	{
		jobId: { type: mongoose.Schema.Types.ObjectId, ref: "ImportJob", required: true },
		index: { type: Number, required: true, min: 0 },
		rows: { type: [mongoose.Schema.Types.Mixed], default: [] },
		createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 60 * 60 },
	},
	{ versionKey: false }
);

importChunkSchema.index({ jobId: 1, index: 1 }, { unique: true });

export default mongoose.models.ImportChunk || mongoose.model("ImportChunk", importChunkSchema);
