import mongoose from "mongoose";

// What each AI call was for. Every call through lib/gtm/ai.js names one of these, so the cost model can say
// which step of the product is expensive rather than just totalling a monthly bill.
export const GTM_AI_PURPOSES = ["profile_extract", "interview_questions", "profile_refine", "draft_reply", "score_opportunity"];

// One row per AI call, written whether the call succeeded or failed. The cost model is built from this
// table, so it records the model actually used and the tokens actually billed, not an estimate of either.
const aiUsageSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		// Null for a call made before a product exists (the dev prompt-check command, Phase 5).
		productId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmProduct", default: null },
		// Which part of Namag spent the money. Always "gtm" today; here so a second module that starts
		// calling an AI shares one usage table instead of growing a second one.
		product: { type: String, required: true, trim: true, default: "gtm", maxlength: 40 },
		purpose: { type: String, enum: GTM_AI_PURPOSES, required: true },
		model: { type: String, required: true, trim: true, maxlength: 80 },
		inputTokens: { type: Number, min: 0, default: 0 },
		outputTokens: { type: Number, min: 0, default: 0 },
		// US dollars (lib/gtm/config.js estimateAiCost). Null when the model has no price on file, which is
		// honest: a missing price must not be summed as zero.
		estimatedCostUsd: { type: Number, min: 0, default: null },
		// A failed call still costs latency and sometimes tokens, and a run of them is worth seeing.
		ok: { type: Boolean, default: true },
		error: { type: String, trim: true, maxlength: 300 },
		durationMs: { type: Number, min: 0 },
	},
	{ timestamps: true, collection: "gtm_ai_usage" }
);

// The cost report: a workspace's spend over a period, and the same split by what it was spent on.
aiUsageSchema.index({ workspaceId: 1, createdAt: -1 });
aiUsageSchema.index({ purpose: 1, createdAt: -1 });

export default mongoose.models.GtmAiUsage || mongoose.model("GtmAiUsage", aiUsageSchema);
