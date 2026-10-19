import mongoose from "mongoose";

// A sending domain a workspace owns. A workspace can only send from addresses on its own domains,
// even though the domains all live in the platform's one SES account.
const domainSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
		domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
	},
	{ timestamps: true }
);

domainSchema.index({ workspaceId: 1 });

export default mongoose.models.Domain || mongoose.model("Domain", domainSchema);
