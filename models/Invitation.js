import mongoose from "mongoose";
import { ROLES } from "./Membership.js";

export const INVITATION_STATUSES = ["pending", "accepted", "revoked"];

// An invitation to join a workspace. The link carries a random token; only its hash is stored, so a copy of
// the database can't be used to join anything. It works once, until expiresAt.
const invitationSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
		email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
		role: { type: String, enum: ROLES, required: true },
		status: { type: String, enum: INVITATION_STATUSES, default: "pending" },
		tokenHash: { type: String, required: true },
		expiresAt: { type: Date, required: true },
		invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		lastSentAt: { type: Date },
		acceptedAt: { type: Date },
		acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true }
);

invitationSchema.index({ tokenHash: 1 }, { unique: true });
// One open invitation per address per workspace: inviting again refreshes it.
invitationSchema.index({ workspaceId: 1, email: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
invitationSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });

export default mongoose.models.Invitation || mongoose.model("Invitation", invitationSchema);
