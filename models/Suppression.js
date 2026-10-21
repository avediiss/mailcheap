import mongoose from "mongoose";

// Bounces are global: an address that hard-bounced hurts everyone's sending reputation, so no workspace
// emails it again (no workspaceId). Complaints and manual opt-outs belong to the workspace they happened
// in: one client's complainer must not silently vanish from another client's list.
const suppressionSchema = new mongoose.Schema(
	{
		email: { type: String, required: true, lowercase: true, trim: true },
		reason: { type: String, enum: ["bounce", "complaint", "manual"], required: true },
		detail: { type: String },
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace" },
	},
	{ timestamps: true }
);

// One row per address per scope; a missing workspaceId is the global scope.
suppressionSchema.index({ email: 1, workspaceId: 1 }, { unique: true });

export default mongoose.models.Suppression || mongoose.model("Suppression", suppressionSchema);
