import { MongoMemoryServer } from "mongodb-memory-server";

process.env.SESSION_SECRET ||= "s".repeat(40);
process.env.APP_URL ||= "https://mailcheap.test";
process.env.ADMIN_EMAIL ||= "owner@platform.test";
process.env.ADMIN_PASSWORD ||= "platform owner password";
process.env.QSTASH_TOKEN ||= "test-qstash-token";
// Sending is on so the real send path runs; the SES call itself is a recorder (stubs/ses.mjs).
process.env.SENDING_ENABLED = "true";
process.env.ALERT_FROM ||= "Namag <alerts@platform.test>";
// Most tests are about something else and use administrators without a second factor; two-factor.test.mjs turns this back on.
process.env.REQUIRE_ADMIN_2FA = "false";
// Tests never reach the real DNS: the address checks that need it are switched off here and tested with a fake resolver.
process.env.ADDRESS_CHECK_DNS = "off";

// Everything is imported after MONGODB_URI is set, with the same "@/" paths the app uses.
export async function startDb() {
	const server = await MongoMemoryServer.create();
	process.env.MONGODB_URI = server.getUri("mailcheap-test");
	const { connectDb } = await import("@/lib/db");
	const connection = await connectDb();
	const models = await loadModels();
	// Unique indexes (one membership per user, one suppression per scope...) must exist like in production.
	await Promise.all(Object.values(models).map((model) => model.init()));
	return {
		models,
		async reset() {
			await Promise.all(Object.values(models).map((model) => model.deleteMany({})));
			resetRequest();
		},
		async stop() {
			await connection.disconnect();
			await server.stop();
		},
	};
}

async function loadModels() {
	const names = ["Alert", "ApiKey", "AuditLog", "BlockedDomain", "Campaign", "Contact", "ContactField", "Domain", "Event", "Invitation", "Membership", "Message", "Newsletter", "Segment", "Suppression", "User", "Workspace"];
	const loaded = await Promise.all(names.map((name) => import(`@/models/${name}`)));
	return Object.fromEntries(names.map((name, index) => [name, loaded[index].default]));
}

export function resetRequest() {
	globalThis.__testRequest = { cookies: new Map(), headers: new Map() };
	globalThis.__afterTasks = [];
	globalThis.__sentEmails = [];
	globalThis.__sesIdentities = new Set();
	globalThis.__sesBehavior = undefined;
	globalThis.__sesDomains = [];
	globalThis.__qstashCalls = [];
}

export async function loginAs(user) {
	const { signSessionToken, SESSION_COOKIE } = await import("@/lib/session-token");
	const { WORKSPACE_COOKIE } = await import("@/lib/workspace");
	resetRequest();
	const jar = globalThis.__testRequest.cookies;
	jar.set(SESSION_COOKIE, await signSessionToken({ userId: user._id, sessionVersion: user.sessionVersion ?? 0 }));
	return { jar, WORKSPACE_COOKIE };
}

export function logout() {
	resetRequest();
}

// A workspace with an owner (and optionally an editor), its own domain, a newsletter, a contact and a draft
// campaign, an API key. Every id is returned so a test can try to reach it from another workspace.
export async function makeTenant(models, { name, slug, domain = `${slug}.test`, withEditor = false, isPlatformAdmin = false }) {
	const { hashPassword } = await import("@/lib/passwords");
	const { generateApiKey } = await import("@/lib/api-keys");
	const passwordHash = await hashPassword("a long enough password");

	const workspace = await models.Workspace.create({ name, slug });
	await models.Domain.create({ workspaceId: workspace._id, domain });
	const owner = await models.User.create({ email: `owner@${domain}`, name: `${name} owner`, passwordHash, isPlatformAdmin });
	await models.Membership.create({ userId: owner._id, workspaceId: workspace._id, role: "owner" });
	let editor = null;
	if (withEditor) {
		editor = await models.User.create({ email: `editor@${domain}`, passwordHash });
		await models.Membership.create({ userId: editor._id, workspaceId: workspace._id, role: "editor" });
	}

	const newsletter = await models.Newsletter.create({
		workspaceId: workspace._id,
		name: `${name} weekly`,
		slug: `${slug}-weekly`,
		fromEmail: `hello@${domain}`,
		postalAddress: "1 Test Street, Paris",
	});
	const contact = await models.Contact.create({
		workspaceId: workspace._id,
		newsletterId: newsletter._id,
		email: `reader@${slug}-readers.test`,
		status: "active",
		source: "test",
	});
	const campaign = await models.Campaign.create({
		workspaceId: workspace._id,
		newsletterId: newsletter._id,
		subject: `${name} issue`,
		format: "markdown",
		markdown: "Hello there, this is an issue.",
	});
	const { key, prefix, hash } = generateApiKey();
	const apiKey = await models.ApiKey.create({ workspaceId: workspace._id, name: `${name} site`, prefix, hash });
	return { workspace, owner, editor, newsletter, contact, campaign, apiKey, apiKeySecret: key, domain };
}

// Runs an action that ends with redirect()/notFound(): returns what it threw instead.
export async function catching(run) {
	try {
		return { value: await run() };
	} catch (error) {
		return { thrown: error, redirectTo: error.redirectTo, isNotFound: error.message === "NEXT_NOT_FOUND" };
	}
}
