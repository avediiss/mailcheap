import mongoose from "mongoose";

import { ROLES } from "../lib/roles.js";

export { ROLES };

const membershipSchema = new mongoose.Schema(
	{
		userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
		role: { type: String, enum: ROLES, required: true },
	},
	{ timestamps: true }
);

membershipSchema.index({ userId: 1, workspaceId: 1 }, { unique: true });
membershipSchema.index({ workspaceId: 1 });

export default mongoose.models.Membership || mongoose.model("Membership", membershipSchema);
