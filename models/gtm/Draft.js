import mongoose from "mongoose";

// draft: as the AI wrote it. edited: the founder changed it. used: it was posted or copied. discarded:
// they threw it away but kept the opportunity, so a new draft can be written for the same post.
export const GTM_DRAFT_STATUSES = ["draft", "edited", "used", "discarded"];

// A reply in the founder's voice. The AI's text and the founder's edit are kept side by side: the gap
// between them is the only honest measure of whether the voice samples are working.
const draftSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		opportunityId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmOpportunity", required: true },
		originalText: { type: String, required: true, maxlength: 10_000 },
		editedText: { type: String, maxlength: 10_000 },
		status: { type: String, enum: GTM_DRAFT_STATUSES, default: "draft" },
	},
	{ timestamps: true, collection: "gtm_drafts" }
);

draftSchema.index({ opportunityId: 1, createdAt: -1 });

export default mongoose.models.GtmDraft || mongoose.model("GtmDraft", draftSchema);
