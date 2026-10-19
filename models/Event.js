import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", index: true },
		type: { type: String, required: true },
		sesMessageId: { type: String, index: true },
		messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
		campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
		email: { type: String, lowercase: true, trim: true },
		occurredAt: { type: Date, default: Date.now },
		data: { type: mongoose.Schema.Types.Mixed },
	},
	{ timestamps: true }
);

// Only problem events are stored (see lib/ses-events.js); deliveries and engagement live on Message.
eventSchema.index({ campaignId: 1, type: 1 });

export default mongoose.models.Event || mongoose.model("Event", eventSchema);
