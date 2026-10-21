import mongoose from "mongoose";

export const MESSAGE_STATUSES = [
	"queued",
	"sent",
	"delivered",
	"bounced",
	"complained",
	"failed",
	"suppressed",
];

const messageSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		kind: { type: String, enum: ["campaign", "last-chance", "welcome", "confirmation", "test", "sequence"], required: true },
		campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },
		// Which subject an A/B test campaign sent this contact (lib/ab-test.js).
		variant: { type: String, enum: ["A", "B"] },
		// Welcome series: the step (0, 1, ...) of the newsletter's sequence this email is.
		step: { type: Number, min: 0 },
		email: { type: String, required: true, lowercase: true, trim: true },
		provider: { type: String },
		status: { type: String, enum: MESSAGE_STATUSES, default: "queued" },
		sesMessageId: { type: String },
		error: { type: String },
		sentAt: Date,
		deliveredAt: Date,
		openedAt: Date,
		clickedAt: Date,
		bouncedAt: Date,
		complainedAt: Date,
	},
	{ timestamps: true }
);

// One email per contact per campaign, even if a send job is retried.
messageSchema.index(
	{ campaignId: 1, contactId: 1 },
	{ unique: true, partialFilterExpression: { kind: "campaign" } }
);
// And at most one last-chance email per contact per send.
messageSchema.index(
	{ campaignId: 1, contactId: 1, kind: 1 },
	{ unique: true, partialFilterExpression: { kind: "last-chance" } }
);
// And one email per contact per welcome-series step.
messageSchema.index(
	{ contactId: 1, step: 1 },
	{ unique: true, partialFilterExpression: { kind: "sequence" } }
);
// The A/B test results.
messageSchema.index({ campaignId: 1, variant: 1 }, { sparse: true });
messageSchema.index({ sesMessageId: 1 }, { sparse: true });
messageSchema.index({ kind: 1, createdAt: -1 });
// The overview's emails sent per hour.
messageSchema.index({ newsletterId: 1, sentAt: 1 });
// Emails sent per workspace per month: limits and, later, billing.
messageSchema.index({ workspaceId: 1, sentAt: 1 });
messageSchema.index({ campaignId: 1, status: 1 });

export default mongoose.models.Message || mongoose.model("Message", messageSchema);
