import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
	{
		email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
		name: { type: String, trim: true, maxlength: 120 },
		// "scrypt$N$r$p$salt$hash" (lib/passwords.js). Never sent to the browser.
		passwordHash: { type: String, required: true },
		// The platform owner: sees every workspace and creates new ones.
		isPlatformAdmin: { type: Boolean, default: false },
		// Raising it signs this person out everywhere (a password change does).
		sessionVersion: { type: Number, default: 0 },
		disabledAt: { type: Date },
		lastLoginAt: { type: Date },
		// A password-reset link: only the hash is kept, and it works once, before expiresAt.
		passwordReset: {
			tokenHash: { type: String },
			expiresAt: { type: Date },
			requestedAt: { type: Date },
		},
	},
	{ timestamps: true }
);

userSchema.index({ "passwordReset.tokenHash": 1 }, { sparse: true });

export default mongoose.models.User || mongoose.model("User", userSchema);
