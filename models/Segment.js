import mongoose from "mongoose";

// A saved question about a newsletter's contacts (lib/segments.js). Who is in it is worked out when it is used.
const conditionSchema = new mongoose.Schema(
	{
		field: { type: String, required: true, maxlength: 60 },
		op: { type: String, required: true, maxlength: 20 },
		// Text or a number; never an object (lib/segments.js only keeps those).
		value: { type: mongoose.Schema.Types.Mixed },
	},
	{ _id: false }
);

const segmentSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		name: { type: String, required: true, trim: true, maxlength: 60 },
		match: { type: String, enum: ["all", "any"], default: "all" },
		conditions: { type: [conditionSchema], default: [] },
	},
	{ timestamps: true }
);

segmentSchema.index({ workspaceId: 1, newsletterId: 1, createdAt: 1 });

export default mongoose.models.Segment || mongoose.model("Segment", segmentSchema);
