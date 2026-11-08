import mongoose from "mongoose";

// One visit to a tracked link. The address is stored only as a hash, never raw: counting unique visitors
// doesn't need to know who they were, and a leaked backup shouldn't say either.
const clickSchema = new mongoose.Schema(
	{
		// Denormalised from the link so a workspace's clicks can be counted without a join.
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		linkId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmLink", required: true },
		clickedAt: { type: Date, default: Date.now },
		referrer: { type: String, trim: true, maxlength: 2000 },
		ipHash: { type: String, trim: true, maxlength: 64 },
	},
	{ timestamps: true, collection: "gtm_clicks" }
);

clickSchema.index({ linkId: 1, clickedAt: -1 });

export default mongoose.models.GtmClick || mongoose.model("GtmClick", clickSchema);
