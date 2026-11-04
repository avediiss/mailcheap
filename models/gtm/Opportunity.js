import mongoose from "mongoose";

import { GTM_PLATFORMS } from "@/models/gtm/WatchedSource";

// new: found and scored, waiting for the founder. drafted: a reply exists. skipped: they said no, and the
// radar must not offer it again. actioned: the reply went out or was copied.
export const GTM_OPPORTUNITY_STATUSES = ["new", "drafted", "skipped", "actioned"];

// A post the radar thinks is worth a reply. Nothing writes to this table until next week; the schema is
// here now so the score and the reason have somewhere to go without a second migration.
const opportunitySchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		productId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmProduct", required: true },
		platform: { type: String, enum: GTM_PLATFORMS, required: true },
		// The platform's own id for the post. Unique per product, so re-scanning the same account finds
		// the post again and updates it instead of showing the founder a duplicate.
		externalId: { type: String, required: true, trim: true, maxlength: 300 },
		url: { type: String, required: true, trim: true, maxlength: 2000 },
		author: { type: String, trim: true, maxlength: 200 },
		text: { type: String, maxlength: 20_000 },
		postedAt: { type: Date },
		score: { type: Number, min: 0, max: 100 },
		// What made up the score, by name, so a founder can be shown why this post was ranked first.
		scoreBreakdown: { type: mongoose.Schema.Types.Mixed },
		reason: { type: String, trim: true, maxlength: 500 },
		status: { type: String, enum: GTM_OPPORTUNITY_STATUSES, default: "new" },
	},
	{ timestamps: true, collection: "gtm_opportunities" }
);

opportunitySchema.index({ productId: 1, externalId: 1 }, { unique: true });
// The queue: this product's unhandled posts, best first.
opportunitySchema.index({ productId: 1, status: 1, score: -1 });

export default mongoose.models.GtmOpportunity || mongoose.model("GtmOpportunity", opportunitySchema);
