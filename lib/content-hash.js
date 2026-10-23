import crypto from "node:crypto";

// A fingerprint of an email's text, so a review decision only counts for the words it was made on.
export function contentHash({ subject = "", previewText = "", body = "" } = {}) {
	return crypto.createHash("sha256").update(JSON.stringify([subject, previewText, body])).digest("hex");
}
