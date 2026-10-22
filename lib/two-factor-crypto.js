import "server-only";
import crypto from "node:crypto";
import { MIN_SESSION_SECRET_LENGTH } from "@/lib/config";

// What is stored for two-factor login is only useful with the server's SESSION_SECRET: a copy of the database
// alone can't produce anyone's codes. Keys are derived per purpose, so none can be used for another.
function deriveKey(purpose) {
	const secret = process.env.SESSION_SECRET;
	if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) throw new Error(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`);
	return Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.alloc(0), `mailcheap-${purpose}-v1`, 32));
}

// "v1.iv.tag.ciphertext": AES-256-GCM, so a changed value is detected rather than decrypted to nonsense.
export function encryptSecret(plain) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey("2fa-secret"), iv);
	const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
	return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

// null when the value is missing, was changed, or was made under a different SESSION_SECRET.
export function decryptSecret(stored) {
	const [version, iv, tag, encrypted] = String(stored ?? "").split(".");
	if (version !== "v1" || !iv || !tag || !encrypted) return null;
	try {
		const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey("2fa-secret"), Buffer.from(iv, "base64url"));
		decipher.setAuthTag(Buffer.from(tag, "base64url"));
		return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
	} catch {
		return null;
	}
}

// Recovery codes are kept as keyed hashes: they carry less randomness than a password hash is built for, so
// the key (which isn't in the database) is what keeps a leaked copy from being guessed offline.
export function hashRecoveryCode(normalized) {
	return crypto.createHmac("sha256", deriveKey("2fa-recovery")).update(String(normalized)).digest("hex");
}
