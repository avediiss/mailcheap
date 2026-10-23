// A local demo of the whole app with realistic data, on a temporary database that disappears when you stop it.
// Nothing here touches production, AWS or real email: sending is off and the sending service is simulated.
//
//   npm run dev:demo      then open http://localhost:3100
//
// The log-in details are printed when it starts. Ctrl+C stops everything.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hashPassword } from "../lib/passwords.js";
import { contentHash } from "../lib/content-hash.js";
import { scanContent } from "../lib/content-scan.js";
import { createInviteToken, getInviteExpiry } from "../lib/invitation-rules.js";
import BlockedDomain from "../models/BlockedDomain.js";
import Campaign from "../models/Campaign.js";
import Contact from "../models/Contact.js";
import Domain from "../models/Domain.js";
import Invitation from "../models/Invitation.js";
import Membership from "../models/Membership.js";
import Message from "../models/Message.js";
import Newsletter from "../models/Newsletter.js";
import User from "../models/User.js";
import Workspace from "../models/Workspace.js";
import AuditLog from "../models/AuditLog.js";
import ApiKey from "../models/ApiKey.js";

const PORT = process.env.DEMO_PORT || "3100";
// Demo-only secrets, generated fresh each run except the password, which is printed below.
const PASSWORD = "demo-password-123";
const DAY = 86_400_000;

const server = await MongoMemoryServer.create();
const uri = server.getUri("mailcheap-demo");
await mongoose.connect(uri);

async function user(email, name, extra = {}) {
	return User.create({ email, name, passwordHash: await hashPassword(PASSWORD), lastLoginAt: new Date(Date.now() - Math.random() * 5 * DAY), ...extra });
}

async function tenant({ name, slug, status = "active", domain, owner, editor, newsletterName, contacts }) {
	const workspace = await Workspace.create({ name, slug, status });
	await Domain.create({ workspaceId: workspace._id, domain });
	await Membership.create({ userId: owner._id, workspaceId: workspace._id, role: "owner" });
	if (editor) await Membership.create({ userId: editor._id, workspaceId: workspace._id, role: "editor" });
	const newsletter = await Newsletter.create({
		workspaceId: workspace._id, name: newsletterName, slug: `${slug}-notes`, fromName: newsletterName, fromEmail: `hello@${domain}`,
		postalAddress: "12 Rue de l'Exemple, Paris", archiveEnabled: true,
	});
	const names = ["Ava", "Noah", "Mia", "Leo", "Zoe", "Eli", "Ivy", "Max", "Lea", "Sam", "Nina", "Hugo", "Cleo", "Paul", "Rose", "Theo"];
	const docs = Array.from({ length: contacts }, (_, index) => ({
		workspaceId: workspace._id, newsletterId: newsletter._id, email: `${names[index % names.length].toLowerCase()}${index}@example.com`,
		firstName: index % 3 === 0 ? undefined : names[index % names.length], status: index % 11 === 0 ? "unsubscribed" : "active", unsubscribedAt: index % 11 === 0 ? new Date(Date.now() - index * DAY / 3) : undefined,
		source: index % 4 === 0 ? "import" : "website", subscribedAt: new Date(Date.now() - index * 2 * DAY), createdAt: new Date(Date.now() - index * 2 * DAY),
		lastOpenAt: index % 2 ? new Date(Date.now() - index * DAY) : undefined, tags: index % 5 === 0 ? ["vip"] : [],
	}));
	await Contact.insertMany(docs);
	const stats = { recipients: contacts, sent: contacts, delivered: contacts - 2, opened: Math.round(contacts * 0.52), clicked: Math.round(contacts * 0.11), bounced: 1, complained: 0, unsubscribed: 1, failed: 0 };
	await Campaign.create({ workspaceId: workspace._id, newsletterId: newsletter._id, subject: `${newsletterName}: what we shipped this month`, status: "sent", format: "markdown", markdown: "Hello from the demo.", stats, startedAt: new Date(Date.now() - 6 * DAY), sentAt: new Date(Date.now() - 6 * DAY) });
	await Campaign.create({ workspaceId: workspace._id, newsletterId: newsletter._id, subject: "Draft: autumn plans", status: "draft", format: "markdown", markdown: "Work in progress." });
	await Message.create({ kind: "welcome", workspaceId: workspace._id, newsletterId: newsletter._id, email: "x@example.com", status: "sent", sentAt: new Date() });
	await ApiKey.create({ workspaceId: workspace._id, name: `${name} website`, prefix: "mc_demo1234", hash: crypto.randomBytes(16).toString("hex"), lastUsedAt: new Date(Date.now() - DAY) });
	return { workspace, newsletter };
}

const root = await user("root@demo.test", "Platform administrator", { isPlatformAdmin: true });
const avedisOwner = await user("avedis@demo.test", "Avedis (newsletter owner)");
const dana = await user("dana@acme-studio.test", "Dana Whitfield");
const marcus = await user("marcus@acme-studio.test", "Marcus Lee");
const birch = await user("owner@birch.test", "Birch Owner");

const avedis = await tenant({ name: "Avedis", slug: "avedis", domain: "abakelianavedis.com", owner: avedisOwner, newsletterName: "Avedis Notes", contacts: 12 });
const acme = await tenant({ name: "Acme Studio", slug: "acme", domain: "acme-studio.test", owner: dana, editor: marcus, newsletterName: "Acme Notes", contacts: 34 });
await tenant({ name: "Birch & Co", slug: "birch", status: "suspended", domain: "birch.test", owner: birch, newsletterName: "Birch Weekly", contacts: 8 });
// Limits and sending history, so the platform console has something to show: Acme is close to its limits,
// Birch has a bounce problem and is suspended.
const birchWorkspace = await Workspace.findOne({ slug: "birch" });
await Workspace.updateOne({ _id: acme.workspace._id }, { $set: { limits: { contacts: 40, emailsPerMonth: 100, newsletters: 3 } } });
await Workspace.updateOne({ _id: birchWorkspace._id }, { $set: { limits: { contacts: 20, emailsPerMonth: 500, newsletters: 1 } } });
// Ninety days of sending per workspace, so the console's charts have a shape: a weekday rhythm, a growing
// workspace, one with a bounce problem that gets worse, and one that stopped sending a month and a half ago.
// SES doesn't report deliveries, so none are recorded (the console says so).
const newsletterOf = async (tenant) => (await Newsletter.findOne({ workspaceId: tenant._id }))._id;
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const profiles = [
	{ tenant: acme.workspace, base: 4, growth: 0.04, bounce: 0.01, open: 0.52, click: 0.1 },
	{ tenant: avedis.workspace, base: 2, growth: 0.01, bounce: 0.005, open: 0.61, click: 0.14 },
	{ tenant: birchWorkspace, base: 5, growth: 0, bounce: 0.04, open: 0.35, click: 0.05, worsening: true },
];
for (const { tenant, base, growth, bounce, open, click, worsening } of profiles) {
	const newsletterId = await newsletterOf(tenant);
	const docs = [];
	for (let daysAgo = 89; daysAgo >= 0; daysAgo--) {
		const day = new Date(Date.now() - daysAgo * DAY);
		const weekday = day.getUTCDay();
		const rhythm = weekday === 2 || weekday === 4 ? 1.8 : weekday === 0 || weekday === 6 ? 0.3 : 1;
		const count = Math.round(base * rhythm * (1 + growth * (89 - daysAgo)) * (0.7 + random() * 0.6));
		const bounceRate = worsening ? bounce * (0.3 + (89 - daysAgo) / 89 * 1.4) : bounce;
		for (let index = 0; index < count; index++) {
			const sentAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 7 + Math.floor(random() * 12), Math.floor(random() * 60)));
			if (sentAt > new Date()) continue;
			docs.push({
				kind: "welcome", workspaceId: tenant._id, newsletterId, email: `s${daysAgo}-${index}@example.com`, status: "sent", sentAt,
				...(random() < bounceRate && { bouncedAt: sentAt }),
				...(random() < bounceRate / 12 && { complainedAt: sentAt }),
				...(random() < open && { openedAt: sentAt }),
				...(random() < click && { clickedAt: sentAt }),
			});
		}
	}
	await Message.insertMany(docs);
}
// Dune Studio stopped sending 45 days ago. Acme's monthly limit sits just above its pace, so it reads as "close".
const dune = await tenant({ name: "Dune Studio", slug: "dune", domain: "dune.test", owner: await user("owner@dune.test", "Dune Owner"), newsletterName: "Dune Dispatch", contacts: 6 });
await Message.deleteMany({ workspaceId: dune.workspace._id });
await Message.insertMany(Array.from({ length: 30 }, (_, index) => ({ kind: "welcome", workspaceId: dune.workspace._id, newsletterId: dune.newsletter._id, email: `d${index}@example.com`, status: "sent", sentAt: new Date(Date.now() - (45 + (index % 12)) * DAY) })));
const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
const acmeThisMonth = await Message.countDocuments({ workspaceId: acme.workspace._id, sentAt: { $gte: startOfMonth } });
await Workspace.updateOne({ _id: acme.workspace._id }, { $set: { limits: { contacts: 40, emailsPerMonth: Math.max(Math.round(acmeThisMonth / 0.85), 20), newsletters: 3 } } });
// A new sender in its fourth day of warm-up, a flagged issue waiting for review, a blocked workspace and a blocked domain.
const elm = await tenant({ name: "Elm Collective", slug: "elm", domain: "elm.test", owner: await user("owner@elm.test", "Elm Owner"), newsletterName: "Elm Letters", contacts: 20 });
await Message.deleteMany({ workspaceId: elm.workspace._id });
const elmSend = (count, daysAgo) => Array.from({ length: count }, (_, index) => ({ kind: "welcome", workspaceId: elm.workspace._id, newsletterId: elm.newsletter._id, email: `e${daysAgo}-${index}@example.com`, status: "sent", sentAt: new Date(Date.now() - daysAgo * DAY - index * 1000) }));
await Message.insertMany([...elmSend(100, 3), ...elmSend(120, 0)]);
const flaggedBody = "Your account has been suspended. [Verify your password](https://acme-login.example.net/restore) today.";
await Campaign.create({
	workspaceId: acme.workspace._id, newsletterId: acme.newsletter._id, subject: "Action required on your account", format: "markdown", markdown: flaggedBody, status: "draft",
	review: { status: "pending", hash: contentHash({ subject: "Action required on your account", previewText: "", body: flaggedBody }), reasons: scanContent({ subject: "x", body: flaggedBody }).reasons, requestedAt: new Date(Date.now() - 3600_000) },
});
await Workspace.updateOne({ _id: birchWorkspace._id }, { $set: { blockedAt: new Date(), blockReason: "7.0% of the last 7 days' emails bounced (the limit is 5%)" } });
await BlockedDomain.create({ domain: "spam-source.test", reason: "bulk junk signups" });
// Things that aren't going out as they should.
await Campaign.create({ workspaceId: acme.workspace._id, newsletterId: acme.newsletter._id, subject: "Autumn launch", status: "sending", format: "markdown", markdown: "Big news.", startedAt: new Date(Date.now() - 4 * 3600_000) });
await Campaign.collection.updateOne({ subject: "Autumn launch" }, { $set: { updatedAt: new Date(Date.now() - 3 * 3600_000) } });
await Campaign.create({ workspaceId: birchWorkspace._id, newsletterId: await newsletterOf(birchWorkspace), subject: "Fall sale", status: "paused", format: "markdown", markdown: "Sale." });
await Message.insertMany(Array.from({ length: 5 }, (_, index) => ({ kind: "welcome", workspaceId: birchWorkspace._id, newsletterId: dune.newsletter._id, email: `f${index}@example.com`, status: "failed", error: "Mailbox does not exist", sentAt: undefined })));
for (const [workspaceId, action, actor] of [
	[acme.workspace._id, "workspace.created", root], [acme.workspace._id, "workspace.limits", root],
	[birchWorkspace._id, "workspace.created", root], [birchWorkspace._id, "workspace.suspended", root],
]) {
	await AuditLog.create({ workspaceId, action, actorId: actor._id, actorEmail: actor.email });
}
await Domain.create({ workspaceId: acme.workspace._id, domain: "studio-mail.test" });
await Domain.create({ workspaceId: acme.workspace._id, domain: "not-yet-added.test" });
await Domain.collection.updateOne({ domain: "not-yet-added.test" }, { $set: { createdAt: new Date(Date.now() - 6 * DAY) } });

for (const [email, role, expiresIn] of [["priya@acme-studio.test", "editor", 5 * DAY], ["old-invite@acme-studio.test", "owner", -2 * DAY]]) {
	const { tokenHash } = createInviteToken();
	await Invitation.create({ workspaceId: acme.workspace._id, email, role, tokenHash, expiresAt: new Date(Date.now() + expiresIn), invitedBy: dana._id });
}
void getInviteExpiry;

const sesDomains = [
	{ domain: "acme-studio.test", verified: true, dkimStatus: "SUCCESS", mailFromDomain: "mail.acme-studio.test", mailFromStatus: "SUCCESS", records: [
		{ type: "CNAME", name: "abc123._domainkey.acme-studio.test", value: "abc123.dkim.amazonses.com" },
		{ type: "MX", name: "mail.acme-studio.test", value: "10 feedback-smtp.eu-north-1.amazonses.com" },
		{ type: "TXT", name: "mail.acme-studio.test", value: "v=spf1 include:amazonses.com ~all" } ] },
	{ domain: "studio-mail.test", verified: false, dkimStatus: "PENDING", mailFromDomain: "mail.studio-mail.test", mailFromStatus: "PENDING", records: [
		{ type: "CNAME", name: "k1x9._domainkey.studio-mail.test", value: "k1x9.dkim.amazonses.com" },
		{ type: "CNAME", name: "m2y8._domainkey.studio-mail.test", value: "m2y8.dkim.amazonses.com" },
		{ type: "MX", name: "mail.studio-mail.test", value: "10 feedback-smtp.eu-north-1.amazonses.com" },
		{ type: "TXT", name: "mail.studio-mail.test", value: "v=spf1 include:amazonses.com ~all" } ] },
	{ domain: "abakelianavedis.com", verified: true, dkimStatus: "SUCCESS", records: [] },
	{ domain: "birch.test", verified: true, dkimStatus: "SUCCESS", records: [] },
];

console.log(`
  Namag demo
  --------------
  Open:      http://localhost:${PORT}
  Platform admin:   root@demo.test (console only, no workspace)
  Avedis owner:     avedis@demo.test
  Acme owner:       dana@acme-studio.test
  Acme editor:      marcus@acme-studio.test
  Suspended owner:  owner@birch.test
  Password for all: ${PASSWORD}

  Temporary database, sending off. Ctrl+C stops it.
`);

const child = spawn("npx", ["next", "dev", "--webpack", "-p", PORT], {
	stdio: "inherit",
	env: {
		...process.env,
		MONGODB_URI: uri,
		SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
		ADMIN_EMAIL: "root@demo.test",
		REQUIRE_ADMIN_2FA: "false",
		ADMIN_PASSWORD: PASSWORD + "-unused",
		APP_URL: `http://localhost:${PORT}`,
		SENDING_ENABLED: "false",
		SES_DEMO_DOMAINS: JSON.stringify(sesDomains),
	},
});

async function stop() {
	child.kill("SIGINT");
	await mongoose.disconnect();
	await server.stop();
	process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", stop);
