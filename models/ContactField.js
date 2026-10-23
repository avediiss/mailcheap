import mongoose from "mongoose";

// A custom field a workspace has defined for its contacts (lib/contact-fields.js). The values live on each contact
// under fields.<key>; this is only the list of what exists, its label and its type.
const contactFieldSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
		key: { type: String, required: true, lowercase: true, trim: true, maxlength: 30 },
		label: { type: String, required: true, trim: true, maxlength: 40 },
		type: { type: String, enum: ["text", "number", "date"], required: true },
	},
	{ timestamps: true }
);

contactFieldSchema.index({ workspaceId: 1, key: 1 }, { unique: true });

export default mongoose.models.ContactField || mongoose.model("ContactField", contactFieldSchema);
