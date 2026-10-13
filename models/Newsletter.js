import mongoose from "mongoose";

const newsletterSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true },
		slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
		imageUrl: { type: String, trim: true },
		fromName: { type: String, trim: true },
		fromEmail: { type: String, required: true, lowercase: true, trim: true },
		replyTo: { type: String, lowercase: true, trim: true },
		postalAddress: { type: String, trim: true },
		archiveEnabled: { type: Boolean, default: false },
		description: { type: String, trim: true },
		socialLinks: [{ type: String, trim: true }],
		// The archive's author page; the author's name is fromName.
		author: {
			bio: { type: String, trim: true },
			imageUrl: { type: String, trim: true },
		},
		// New signups get an email with a link and only join once they click it (confirmed opt-in).
		requireConfirmation: { type: Boolean, default: false },
		// Email ADMIN_EMAIL when someone subscribes (lib/signup-notice.js). Needs ALERT_FROM.
		notifyOnSignup: { type: Boolean, default: false },
		// Checked when an issue is sent (lib/cleanup.js). Empty numbers use the newsletter's defaults.
		cleanup: {
			enabled: { type: Boolean, default: false },
			issues: { type: Number, min: 1 },
			days: { type: Number, min: 1 },
		},
		welcome: {
			enabled: { type: Boolean, default: false },
			subject: { type: String, trim: true },
			previewText: { type: String, trim: true },
			markdown: { type: String },
		},
		// Welcome series (lib/sequence.js): up to 5 more emails, each a number of days after the person joined.
		sequence: {
			enabled: { type: Boolean, default: false },
			steps: [
				{
					_id: false,
					delayDays: { type: Number, min: 1, max: 90 },
					subject: { type: String, trim: true, maxlength: 200 },
					previewText: { type: String, trim: true, maxlength: 300 },
					markdown: { type: String, maxlength: 20000 },
				},
			],
		},
		// The newsletter's own confirmation email; the built-in one goes out until it has one.
		confirmation: {
			subject: { type: String, trim: true },
			previewText: { type: String, trim: true },
			markdown: { type: String },
		},
	},
	{ timestamps: true }
);

export default mongoose.models.Newsletter || mongoose.model("Newsletter", newsletterSchema);
