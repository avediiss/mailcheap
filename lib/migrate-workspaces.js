import Campaign from "../models/Campaign.js";
import Contact from "../models/Contact.js";
import Domain from "../models/Domain.js";
import Event from "../models/Event.js";
import Membership from "../models/Membership.js";
import Message from "../models/Message.js";
import Newsletter from "../models/Newsletter.js";
import Suppression from "../models/Suppression.js";
import User from "../models/User.js";
import Workspace from "../models/Workspace.js";
import ApiKey from "../models/ApiKey.js";
import { hashPassword } from "./passwords.js";
import { getEmailDomain } from "./workspace-rules.js";

// One-time move from "one install, one owner" to workspaces. Everything that exists today goes to one
// workspace, the owner's. Safe to run again: it only fills in what is still missing. With dryRun it reads
// and counts, and writes nothing.
const MISSING = { workspaceId: { $exists: false } };
const EVENT_BATCH = 1000;

function missing(model) {
	return model.countDocuments({ $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }] });
}

export async function migrateWorkspaces({
	dryRun = true,
	workspaceName = "Avedis",
	workspaceSlug = "avedis",
	adminEmail,
	adminPassword,
	assignSuppressions = false,
	log = () => {},
} = {}) {
	const summary = { dryRun, steps: [] };
	const note = (message) => {
		summary.steps.push(message);
		log(message);
	};
	const write = async (description, run) => {
		if (dryRun) return note(`[dry run] would ${description}`);
		const result = await run();
		note(description);
		return result;
	};

	// 1. The workspace for everything that exists today.
	let workspace = await Workspace.findOne({ slug: workspaceSlug });
	const isNewWorkspace = !workspace;
	if (!workspace) {
		workspace = dryRun ? { _id: null, name: workspaceName } : await Workspace.create({ name: workspaceName, slug: workspaceSlug });
		note(`${dryRun ? "[dry run] would create" : "created"} workspace "${workspaceName}" (${workspaceSlug})`);
	} else {
		note(`workspace "${workspace.name}" already exists`);
	}
	summary.workspaceId = workspace._id ? String(workspace._id) : null;

	// 2. The platform owner's account, from ADMIN_EMAIL / ADMIN_PASSWORD, and their place in the workspace.
	if (adminEmail) {
		const email = adminEmail.trim().toLowerCase();
		let user = await User.findOne({ email });
		if (!user && adminPassword) {
			user = await write(`create the platform owner account for ${email}`, async () =>
				User.create({ email, passwordHash: await hashPassword(adminPassword), isPlatformAdmin: true })
			);
		} else if (!user) {
			note(`no account for ${email} yet: it is created at their first login (give ADMIN_PASSWORD to create it now)`);
		} else if (!user.isPlatformAdmin) {
			await write(`make ${email} a platform owner`, () => User.updateOne({ _id: user._id }, { $set: { isPlatformAdmin: true } }));
		}
		if (user?._id && workspace._id) {
			const hasMembership = await Membership.exists({ userId: user._id, workspaceId: workspace._id });
			if (!hasMembership) await write(`make ${email} an owner of "${workspace.name}"`, () => Membership.create({ userId: user._id, workspaceId: workspace._id, role: "owner" }));
		}
	}

	// 3. Newsletters and API keys have no workspace yet: they all belong to the default one.
	summary.newsletters = await missing(Newsletter);
	summary.apiKeys = await missing(ApiKey);
	if (summary.newsletters > 0) await write(`assign ${summary.newsletters} newsletters to the workspace`, () => Newsletter.updateMany(MISSING, { $set: { workspaceId: workspace._id } }));
	if (summary.apiKeys > 0) await write(`assign ${summary.apiKeys} API keys to the workspace`, () => ApiKey.updateMany(MISSING, { $set: { workspaceId: workspace._id } }));

	// 4. Contacts, campaigns and messages follow their newsletter.
	summary.contacts = await missing(Contact);
	summary.campaigns = await missing(Campaign);
	summary.messages = await missing(Message);
	if (!dryRun) {
		const newsletters = await Newsletter.find().select({ _id: 1, workspaceId: 1 }).lean();
		for (const { _id, workspaceId } of newsletters) {
			for (const model of [Contact, Campaign, Message]) {
				await model.updateMany({ newsletterId: _id, ...MISSING }, { $set: { workspaceId } });
			}
		}
	}
	note(`${dryRun ? "[dry run] would assign" : "assigned"} ${summary.contacts} contacts, ${summary.campaigns} campaigns and ${summary.messages} messages to their newsletters' workspaces`);

	// 5. Events follow their message (or their campaign).
	summary.events = await missing(Event);
	if (!dryRun && summary.events > 0) {
		const cursor = Event.find(MISSING).select({ messageId: 1, campaignId: 1 }).lean().cursor();
		let batch = [];
		const flush = async () => {
			if (batch.length === 0) return;
			const [messages, campaigns] = await Promise.all([
				Message.find({ _id: { $in: batch.map(({ messageId }) => messageId).filter(Boolean) } }).select({ workspaceId: 1 }).lean(),
				Campaign.find({ _id: { $in: batch.map(({ campaignId }) => campaignId).filter(Boolean) } }).select({ workspaceId: 1 }).lean(),
			]);
			const byMessage = new Map(messages.map(({ _id, workspaceId }) => [String(_id), workspaceId]));
			const byCampaign = new Map(campaigns.map(({ _id, workspaceId }) => [String(_id), workspaceId]));
			const writes = batch
				.map((event) => ({ event, workspaceId: byMessage.get(String(event.messageId)) ?? byCampaign.get(String(event.campaignId)) ?? workspace._id }))
				.map(({ event, workspaceId }) => ({ updateOne: { filter: { _id: event._id }, update: { $set: { workspaceId } } } }));
			await Event.bulkWrite(writes);
			batch = [];
		};
		for await (const event of cursor) {
			batch.push(event);
			if (batch.length >= EVENT_BATCH) await flush();
		}
		await flush();
	}
	note(`${dryRun ? "[dry run] would assign" : "assigned"} ${summary.events} events`);

	// 6. The domains the newsletters send from belong to the workspace, so they keep sending.
	const fromDomains = new Set((await Newsletter.find().select({ fromEmail: 1 }).lean()).map(({ fromEmail }) => getEmailDomain(fromEmail)).filter(Boolean));
	summary.domains = [];
	for (const domain of fromDomains) {
		if (await Domain.exists({ domain })) continue;
		summary.domains.push(domain);
		await write(`give the workspace the domain ${domain}`, () => Domain.create({ workspaceId: workspace._id, domain }));
	}

	// 7. Suppressions: an address is suppressed once per workspace, so the old one-per-address rule goes.
	const hasOldIndex = (await Suppression.collection.indexes().catch(() => [])).some(({ name }) => name === "email_1");
	if (hasOldIndex) await write("drop the old one-suppression-per-address index", () => Suppression.collection.dropIndex("email_1"));
	if (!dryRun) await Suppression.createIndexes();
	// Complaints and manual opt-outs that happened so far were all this workspace's. Bounces stay global.
	summary.suppressions = await Suppression.countDocuments({ ...MISSING, reason: { $in: ["complaint", "manual"] } });
	if (summary.suppressions > 0 && (isNewWorkspace || assignSuppressions)) {
		await write(`assign ${summary.suppressions} complaint and opt-out suppressions to the workspace`, () =>
			Suppression.updateMany({ ...MISSING, reason: { $in: ["complaint", "manual"] } }, { $set: { workspaceId: workspace._id } })
		);
	} else if (summary.suppressions > 0) {
		note(`${summary.suppressions} complaint/opt-out suppressions have no workspace; run with --assign-suppressions to give them to "${workspace.name}"`);
	}

	// 8. New indexes (per-workspace lists and usage).
	if (!dryRun) {
		for (const model of [Newsletter, Contact, Campaign, Message, ApiKey, Event, Domain, Membership]) await model.createIndexes();
		note("created the new indexes");
	}

	// What is left without a workspace should be nothing.
	summary.remaining = dryRun
		? null
		: {
				newsletters: await missing(Newsletter),
				contacts: await missing(Contact),
				campaigns: await missing(Campaign),
				messages: await missing(Message),
				apiKeys: await missing(ApiKey),
				events: await missing(Event),
			};
	return summary;
}
