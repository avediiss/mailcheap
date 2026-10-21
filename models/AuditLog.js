import mongoose from "mongoose";

// What the platform owner did to a workspace, and when they stepped into one. Kept for good: it is the answer
// to "who changed that".
const auditLogSchema = new mongoose.Schema(
	{
		actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		actorEmail: { type: String, lowercase: true, trim: true },
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace" },
		action: { type: String, required: true },
		detail: { type: mongoose.Schema.Types.Mixed },
	},
	{ timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ workspaceId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

export default mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
