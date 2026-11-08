import mongoose from "mongoose";

// Where the radar looks. "other" is stored rather than rejected: a founder pasting a Discord or Slack link
// should not lose it, even though nothing reads that platform yet.
export const GTM_PLATFORMS = ["x", "reddit", "hn", "other"];

// An account or community the founder wants watched: the URL they pasted, the platform detected from it
// (lib/gtm/platforms.js), and the identifier the radar will actually query — a handle, a subreddit name.
const watchedSourceSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		productId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmProduct", required: true },
		platform: { type: String, enum: GTM_PLATFORMS, required: true },
		url: { type: String, required: true, trim: true, maxlength: 2000 },
		identifier: { type: String, required: true, trim: true, maxlength: 200 },
		// Switched off instead of deleted, so an old source stops being scanned without orphaning the
		// opportunities it already produced.
		active: { type: Boolean, default: true },
		// How far the radar has read. The next scan asks only for what is newer, so a post is fetched
		// once however often the scan runs. Null means never scanned, and the first scan then looks back
		// a bounded window instead of the whole archive.
		lastScanAt: { type: Date, default: null },
		// Why the last scan of this source failed, kept so a source that has quietly stopped working can
		// be seen rather than inferred from an empty queue. Cleared by the next success.
		lastError: { type: String, trim: true, maxlength: 300, default: null },
	},
	{ timestamps: true, collection: "gtm_watched_sources" }
);

// Pasting the same account twice updates the one row instead of scanning it twice.
watchedSourceSchema.index({ productId: 1, platform: 1, identifier: 1 }, { unique: true });
watchedSourceSchema.index({ productId: 1, active: 1 });

export default mongoose.models.GtmWatchedSource || mongoose.model("GtmWatchedSource", watchedSourceSchema);
