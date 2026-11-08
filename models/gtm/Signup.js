import mongoose from "mongoose";

// Someone who reached the landing page and joined. It points at the Namag contact rather than copying the
// address: the contact is the one record of a subscriber, and this row only says the GTM agent brought them.
// linkId is null when they arrived without a tracked link, so the signup still counts but is unattributed.
const signupSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		productId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmProduct", required: true },
		linkId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmLink", default: null },
		contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true },
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
	},
	{ timestamps: true, collection: "gtm_signups" }
);

// One signup row per contact per product, however many times they come back through a link.
signupSchema.index({ productId: 1, contactId: 1 }, { unique: true });
signupSchema.index({ linkId: 1 });

export default mongoose.models.GtmSignup || mongoose.model("GtmSignup", signupSchema);
