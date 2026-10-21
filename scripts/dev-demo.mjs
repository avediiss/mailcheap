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
import { createInviteToken, getInviteExpiry } from "../lib/invitation-rules.js";
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
		firstName: index % 3 === 0 ? undefined : names[index % names.length], status: index % 11 === 0 ? "unsubscribed" : "active",
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

const root = await user("root@demo.test", "Avedis (platform owner)", { isPlatformAdmin: true });
const dana = await user("dana@acme-studio.test", "Dana Whitfield");
const marcus = await user("marcus@acme-studio.test", "Marcus Lee");
const birch = await user("owner@birch.test", "Birch Owner");

const avedis = await tenant({ name: "Avedis", slug: "avedis", domain: "abakelianavedis.com", owner: root, newsletterName: "Avedis Notes", contacts: 12 });
const acme = await tenant({ name: "Acme Studio", slug: "acme", domain: "acme-studio.test", owner: dana, editor: marcus, newsletterName: "Acme Notes", contacts: 34 });
await tenant({ name: "Birch & Co", slug: "birch", status: "suspended", domain: "birch.test", owner: birch, newsletterName: "Birch Weekly", contacts: 8 });
// Limits and sending history, so the platform console has something to show: Acme is close to its limits,
// Birch has a bounce problem and is suspended.
const birchWorkspace = await Workspace.findOne({ slug: "birch" });
await Workspace.updateOne({ _id: acme.workspace._id }, { $set: { limits: { contacts: 40, emailsPerMonth: 100, newsletters: 3 } } });
await Workspace.updateOne({ _id: birchWorkspace._id }, { $set: { limits: { contacts: 20, emailsPerMonth: 500, newsletters: 1 } } });
const sends = (tenant, count, bounced) =>
	Array.from({ length: count }, (_, index) => ({
		kind: "welcome", workspaceId: tenant._id, newsletterId: null, email: `s${index}@example.com`, status: "sent",
		sentAt: new Date(Date.now() - (index % 20) * DAY), ...(index < bounced && { bouncedAt: new Date() }),
	}));
const newsletterOf = async (tenant) => (await Newsletter.findOne({ workspaceId: tenant._id }))._id;
for (const [tenant, count, bounced] of [[acme.workspace, 82, 1], [birchWorkspace, 70, 7], [avedis.workspace, 39, 1]]) {
	const newsletterId = await newsletterOf(tenant);
	await Message.insertMany(sends(tenant, count, bounced).map((message) => ({ ...message, newsletterId })));
}
for (const [workspaceId, action, actor] of [
	[acme.workspace._id, "workspace.created", root], [acme.workspace._id, "workspace.limits", root],
	[birchWorkspace._id, "workspace.created", root], [birchWorkspace._id, "workspace.suspended", root],
]) {
	await AuditLog.create({ workspaceId, action, actorId: actor._id, actorEmail: actor.email });
}
await Domain.create({ workspaceId: acme.workspace._id, domain: "studio-mail.test" });
await Domain.create({ workspaceId: acme.workspace._id, domain: "not-yet-added.test" });
await Membership.create({ userId: root._id, workspaceId: acme.workspace._id, role: "owner" }).catch(() => {});

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
  Platform owner:   root@demo.test
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
