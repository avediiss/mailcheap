import mongoose from "mongoose";

// Three to five things the founder actually wrote. The drafting prompt is given these verbatim so replies
// sound like them and not like a chatbot; the minimum length (GTM_LIMITS.minVoiceSampleLength) is enforced
// in lib/gtm/voice-samples.js, where the founder can be told why a one-liner isn't enough to copy a voice.
const voiceSampleSchema = new mongoose.Schema(
	{
		workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
		productId: { type: mongoose.Schema.Types.ObjectId, ref: "GtmProduct", required: true },
		text: { type: String, required: true, trim: true, maxlength: 5000 },
	},
	{ timestamps: true, collection: "gtm_voice_samples" }
);

voiceSampleSchema.index({ productId: 1, createdAt: 1 });

export default mongoose.models.GtmVoiceSample || mongoose.model("GtmVoiceSample", voiceSampleSchema);
