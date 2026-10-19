import mongoose from "mongoose";

const apiKeySchema = new mongoose.Schema(
	{
		// A key belongs to one workspace and can only reach its newsletters.
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		name: { type: String, required: true, trim: true },
		prefix: { type: String, required: true },
		hash: { type: String, required: true, unique: true },
		lastUsedAt: { type: Date },
		revokedAt: { type: Date },
	},
	{ timestamps: true }
);

export default mongoose.models.ApiKey || mongoose.model("ApiKey", apiKeySchema);
