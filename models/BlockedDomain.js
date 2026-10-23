import mongoose from "mongoose";

// A domain the platform refuses at signup and import, for every workspace: spam sources the built-in list of
// disposable domains doesn't know. The domain and everything under it is blocked.
const blockedDomainSchema = new mongoose.Schema(
	{
		domain: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 253 },
		reason: { type: String, trim: true, maxlength: 200 },
		addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true }
);

export default mongoose.models.BlockedDomain || mongoose.model("BlockedDomain", blockedDomainSchema);
