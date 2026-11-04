import mongoose from "mongoose";

// posted_x: Namag posted it. handoff_copied: the founder copied it to post themselves — the honest record
// of a reply we can't confirm went out. skipped: they decided against this one.
export const GTM_ACTION_TYPES = ["posted_x", "handoff_copied", "skipped"];

// What was done with a draft, and when. One row per decision: this is the trail behind every click and
// signup the module later attributes to a reply.
const actionSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		draftId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmDraft", required: true },
		type: { type: String, enum: GTM_ACTION_TYPES, required: true },
		doneAt: { type: Date, default: Date.now },
	},
	{ timestamps: true, collection: "gtm_actions" }
);

actionSchema.index({ workspaceId: 1, doneAt: -1 });
actionSchema.index({ draftId: 1 });

export default mongoose.models.GtmAction || mongoose.model("GtmAction", actionSchema);
