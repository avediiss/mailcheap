import mongoose from "mongoose";

// A tracked link to the founder's landing page. One per reply, so a click can be traced back to the post
// it came from; actionId is null for a link made by hand or shared outside a reply.
const linkSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		productId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmProduct", required: true },
		actionId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmAction", default: null },
		// What appears in the short URL. Unique across the platform, since the redirect is looked up by
		// this alone and has no workspace in the path.
		shortCode: { type: String, required: true, trim: true, maxlength: 32 },
		targetUrl: { type: String, required: true, trim: true, maxlength: 2000 },
		// The utm_* parameters added to targetUrl on redirect, by name.
		utm: { type: mongoose.Schema.Types.Mixed },
	},
	{ timestamps: true, collection: "gtm_links" }
);

linkSchema.index({ shortCode: 1 }, { unique: true });
linkSchema.index({ productId: 1, createdAt: -1 });

export default mongoose.models.GtmLink || mongoose.model("GtmLink", linkSchema);
