import mongoose from "mongoose";

export const WORKSPACE_STATUSES = ["active", "suspended"];

// A client, or one of the owner's brands: its own newsletters, contacts, campaigns, keys and domains.
// null in a limit means no limit.
const limit = { type: Number, min: 0, default: null };

const workspaceSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true, maxlength: 80 },
		slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 40 },
		// Suspended: can't send or take API signups. The platform owner can still read it.
		status: { type: String, enum: WORKSPACE_STATUSES, default: "active" },
		limits: { contacts: limit, emailsPerMonth: limit, newsletters: limit },
		// Blocked by the platform's own checks (lib/workspace-health-server.js): why and when. Resuming clears it and
		// starts the bounce and complaint count again from that moment.
		// How fast it may send (lib/send-plan.js): by default it warms up and is held to a multiple of what it has sent
		// before. The platform can trust a workspace that arrives with a proven list, or set its own daily amount.
		sendingTrust: {
			isTrusted: { type: Boolean, default: false },
			dailyCap: { type: Number, min: 1 },
		},
		blockedAt: { type: Date },
		blockReason: { type: String, trim: true, maxlength: 300 },
		healthResetAt: { type: Date },
	},
	{ timestamps: true }
);

export default mongoose.models.Workspace || mongoose.model("Workspace", workspaceSchema);
