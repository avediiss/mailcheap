import mongoose from "mongoose";

// Where the founder is in onboarding, which is also where the wizard resumes (app/(app)/gtm): the site has
// been read, the interview answered, the profile reviewed, sources added, and finally voice samples saved.
export const GTM_ONBOARDING_STATUSES = ["new", "site_read", "interviewed", "profile_reviewed", "sources_added", "ready"];

// The product the GTM agent is finding users for: what the founder's site says, refined by a short
// interview, and the keywords the radar will search on. Fields are camelCase like every other model here;
// only the collection name carries the module's gtm_ prefix.
const productSchema = new mongoose.Schema(
	{
		// No index: true here — the unique index declared below already covers lookups by workspace, and
		// asking for both means two indexes with the same auto-generated name, which MongoDB refuses.
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
		// Who started it. The workspace owns the product — this is for the activity trail, not for access.
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		url: { type: String, required: true, trim: true, maxlength: 2000 },
		name: { type: String, trim: true, maxlength: 120 },
		oneLinePitch: { type: String, trim: true, maxlength: 300 },
		targetCustomer: { type: String, trim: true, maxlength: 300 },
		// The three problems it solves, in the founder's words once they've corrected the AI's guess.
		pains: [{ type: String, trim: true, maxlength: 300 }],
		differentiators: { type: String, trim: true, maxlength: 1000 },
		// What the radar searches for: 8 to 15 of them (GTM_LIMITS), lowercase so they de-duplicate.
		keywords: [{ type: String, trim: true, lowercase: true, maxlength: 60 }],
		// The readable text pulled from the site, kept so the profile can be re-extracted after a prompt
		// change without fetching the site again.
		rawSiteText: { type: String, maxlength: 200_000 },
		// The site had almost no readable text (a JavaScript shell), so the UI asks for a pasted description.
		needsDescription: { type: Boolean, default: false },
		onboardingStatus: { type: String, enum: GTM_ONBOARDING_STATUSES, default: "new" },
	},
	{ timestamps: true, collection: "gtm_products" }
);

// One product per workspace this week. It's a unique index rather than a convention because onboarding
// upserts by workspaceId: without it, two tabs finishing step 1 at once would make two half-built products.
productSchema.index({ workspaceId: 1 }, { unique: true });

export default mongoose.models.GtmProduct || mongoose.model("GtmProduct", productSchema);
