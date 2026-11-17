import mongoose from "mongoose";

// The short interview that fills the gaps the website left: three or four questions the AI wrote after
// reading the site, and the founder's answers, which are sent back to refine the profile. Kept as a row of
// its own so a founder can be re-interviewed later without losing what they said the first time.
const onboardingInterviewSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		productId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmProduct", required: true },
		questions: [{ type: String, trim: true, maxlength: 500 }],
		// Answered in order: answers[i] belongs to questions[i], and a skipped question is an empty string.
		answers: [{ type: String, trim: true, maxlength: 2000 }],
		answeredAt: { type: Date },
	},
	{ timestamps: true, collection: "gtm_onboarding_interviews" }
);

onboardingInterviewSchema.index({ productId: 1, createdAt: -1 });

export default mongoose.models.GtmOnboardingInterview || mongoose.model("GtmOnboardingInterview", onboardingInterviewSchema);
