// The way back in when the only platform administrator lost their phone and their recovery codes. Run it on your
// own computer: it takes two-factor login off one account and signs that account out everywhere.
//
//   MONGODB_URI='mongodb+srv://...' node scripts/reset-2fa.mjs you@example.com
//
// The account logs in with its password alone and, as an administrator, is asked to set two-factor up again.
import mongoose from "mongoose";

const email = String(process.argv[2] ?? "").trim().toLowerCase();
if (!process.env.MONGODB_URI || !email.includes("@")) {
	console.error("Usage: MONGODB_URI='...' node scripts/reset-2fa.mjs <email>");
	process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
try {
	const users = mongoose.connection.db.collection("users");
	const result = await users.updateOne({ email }, { $unset: { twoFactor: "" }, $inc: { sessionVersion: 1 } });
	if (result.matchedCount === 0) throw new Error(`No account with the address ${email}`);
	console.log(`Two-factor login removed for ${email}. They are signed out everywhere.`);
} catch (error) {
	console.error(`\nStopped: ${error.message}`);
	process.exitCode = 1;
} finally {
	await mongoose.disconnect();
}
