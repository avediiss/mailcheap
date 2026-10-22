import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { makeTenant, startDb } from "./helpers.mjs";

let db;
let a;
let b;
before(async () => {
	db = await startDb();
});
after(() => db.stop());

const NOW = new Date("2026-10-22T12:00:00Z");
const at = (day, hour = 10) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
const id = (doc) => String(doc._id);
const names = () => new Map([[id(a.workspace), "Acme"], [id(b.workspace), "Birch"]]);

beforeEach(async () => {
	await db.reset();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
	// The tenant helper's own contact joined long before any range these tests look at.
	await db.models.Contact.updateMany({}, { $set: { subscribedAt: at("2026-01-01"), createdAt: at("2026-01-01") } }, { timestamps: false });
});

function messages(tenant, entries) {
	return db.models.Message.insertMany(
		entries.map(({ day, count = 1, hour = 10, kind = "welcome", ...flags }) => Array.from({ length: count }, (_, index) => ({
			kind, workspaceId: tenant.workspace._id, newsletterId: tenant.newsletter._id, email: `r${index}@example.com`, status: "sent", sentAt: at(day, hour), ...flags,
		}))).flat()
	);
}

test("sends are counted per UTC day and per workspace, without test emails or days outside the range", async () => {
	const { getPlatformInsights } = await import("@/lib/platform-insights");
	await messages(a, [{ day: "2026-10-20", count: 3, bouncedAt: at("2026-10-21") }, { day: "2026-10-20", count: 2 }, { day: "2026-10-22", count: 2 }, { day: "2026-10-21", count: 9, kind: "test" }, { day: "2026-09-01", count: 7 }]);
	await messages(b, [{ day: "2026-10-20", count: 5, complainedAt: at("2026-10-21") }, { day: "2026-10-21", hour: 23, count: 1, openedAt: at("2026-10-22"), clickedAt: at("2026-10-22") }]);

	const insights = await getPlatformInsights({ range: 7, names: names(), now: NOW });
	assert.equal(insights.dayKeys.length, 7);
	assert.equal(insights.dayKeys.at(-1), "2026-10-22");
	const byKey = Object.fromEntries(insights.send.days.map((day) => [day.key, day]));
	assert.equal(byKey["2026-10-20"].sent, 10);
	assert.equal(byKey["2026-10-21"].sent, 1, "23:00 UTC stays on its own day; test emails never count");
	assert.equal(byKey["2026-10-22"].sent, 2);
	assert.equal(insights.send.totals.sent, 13);
	assert.equal(insights.send.totals.bounced, 3);
	assert.equal(insights.send.totals.complained, 5);
	assert.equal(insights.send.totals.opened, 1);
	assert.equal(insights.send.totals.clicked, 1);
	assert.deepEqual(insights.send.perWorkspace[id(a.workspace)].daily, [0, 0, 0, 0, 5, 0, 2]);
	assert.deepEqual(insights.stack.series.map(({ name }) => name), ["Acme", "Birch"].sort((x, y) => (insights.send.perWorkspace[id(b.workspace)].sent > insights.send.perWorkspace[id(a.workspace)].sent ? y.localeCompare(x) : 0)));
	assert.equal(insights.stack.days.reduce((sum, day) => sum + day.total, 0), 13);

	const wider = await getPlatformInsights({ range: 90, names: names(), now: NOW });
	assert.equal(wider.send.totals.sent, 13 + 7, "the older send is inside 90 days");
});

test("one workspace's insights never include another's", async () => {
	const { getPlatformInsights } = await import("@/lib/platform-insights");
	await messages(a, [{ day: "2026-10-22", count: 4 }]);
	await messages(b, [{ day: "2026-10-22", count: 6 }]);
	await db.models.Contact.create({ workspaceId: b.workspace._id, newsletterId: b.newsletter._id, email: "new@birch-readers.test", status: "active", subscribedAt: at("2026-10-21"), createdAt: at("2026-10-21") });

	const own = await getPlatformInsights({ range: 7, names: names(), workspaceId: id(a.workspace), now: NOW });
	assert.equal(own.send.totals.sent, 4);
	assert.deepEqual(Object.keys(own.send.perWorkspace), [id(a.workspace)]);
	assert.equal(own.subscribers.joined, 0, "Birch's new subscriber isn't Acme's");
	assert.equal(own.subscribers.total, 1);
	const everyone = await getPlatformInsights({ range: 7, names: names(), now: NOW });
	assert.equal(everyone.send.totals.sent, 10);
	assert.equal(everyone.subscribers.joined, 1);
});

test("subscribers: the starting count, who joined and left each day, and who is growing", async () => {
	const { getPlatformInsights } = await import("@/lib/platform-insights");
	const contact = (tenant, email, fields) => ({ workspaceId: tenant.workspace._id, newsletterId: tenant.newsletter._id, email, source: "website", ...fields });
	await db.models.Contact.insertMany([
		contact(a, "j1@x.test", { status: "active", subscribedAt: at("2026-10-21"), createdAt: at("2026-10-21") }),
		contact(a, "j2@x.test", { status: "active", subscribedAt: at("2026-10-21", 15), createdAt: at("2026-10-21", 15) }),
		contact(a, "gone@x.test", { status: "unsubscribed", subscribedAt: at("2026-09-01"), createdAt: at("2026-09-01"), unsubscribedAt: at("2026-10-21", 18) }),
		contact(b, "quick@x.test", { status: "unsubscribed", subscribedAt: at("2026-10-20"), createdAt: at("2026-10-20"), unsubscribedAt: at("2026-10-22", 8) }),
		contact(b, "old@x.test", { status: "active", subscribedAt: at("2026-08-01"), createdAt: at("2026-08-01") }),
	]);

	const { subscribers, growthBy } = await getPlatformInsights({ range: 7, names: names(), now: NOW });
	// Before the range: the helper contacts (2), Birch's old one, and Acme's leaver who was still there on the 19th.
	assert.equal(subscribers.start, 4);
	const byKey = Object.fromEntries(subscribers.days.map((day) => [day.key, day]));
	assert.deepEqual([byKey["2026-10-20"].joined, byKey["2026-10-20"].left], [1, 0], "Birch's quick one joined");
	assert.deepEqual([byKey["2026-10-21"].joined, byKey["2026-10-21"].left], [2, 1]);
	assert.deepEqual([byKey["2026-10-22"].joined, byKey["2026-10-22"].left], [0, 1]);
	assert.equal(byKey["2026-10-21"].total, 4 + 1 + 2 - 1);
	assert.equal(subscribers.total, 4 + 3 - 2);
	assert.equal(growthBy.get(id(a.workspace)), 2 - 1);
	assert.equal(growthBy.get(id(b.workspace)) ?? 0, 0, "joined and left inside the range: no net change");
});

test("each workspace's summary carries engagement, last send, cost and where its month is heading", async () => {
	const { listWorkspaceSummaries, getPlatformTotals } = await import("@/lib/platform");
	const { describeAttention, rankAttention } = await import("@/lib/platform-rules");
	await db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { limits: { contacts: null, emailsPerMonth: 100, newsletters: null } } });
	await messages(a, [{ day: "2026-10-05", count: 60, openedAt: at("2026-10-05", 12) }, { day: "2026-10-21", count: 10, clickedAt: at("2026-10-21", 12) }, { day: "2026-10-22", count: 1, kind: "test" }]);
	await messages(b, [{ day: "2026-08-01", count: 2 }]);

	const rows = await listWorkspaceSummaries({ now: NOW });
	const acme = rows.find(({ slug }) => slug === "acme");
	const birch = rows.find(({ slug }) => slug === "birch");
	assert.equal(acme.emailsThisMonth, 70);
	assert.equal(acme.sent30, 70);
	assert.equal(acme.openRate, 60 / 70);
	assert.equal(acme.clickRate, 10 / 70);
	assert.equal(acme.lastSentAt.toISOString(), at("2026-10-21").toISOString(), "a test email isn't a send");
	assert.equal(acme.costThisMonth, 70 / 1000 * 0.1);
	assert.equal(acme.emailsProjection.state, "over", "70 sent in 21.5 days of 31 is about 101, with a limit of 100");
	assert.ok(acme.emailsProjection.projected > 100);
	assert.equal(birch.emailsProjection.state, "none", "no limit, no forecast");
	assert.equal(birch.lastSentAt.toISOString(), at("2026-08-01").toISOString());

	assert.ok(describeAttention(acme).some((reason) => /On pace for about \d+ emails this month, over its limit/.test(reason)));
	assert.deepEqual(rankAttention(rows).map(({ slug }) => slug), ["acme"]);
	const totals = getPlatformTotals(rows);
	assert.equal(totals.opened30, 60);
	assert.equal(totals.openRate, 60 / 70);
});

test("sending problems: paused sends, sends that stopped moving, and failed emails by workspace", async () => {
	const { listSendingProblems } = await import("@/lib/platform-problems");
	const campaign = (tenant, fields) => db.models.Campaign.create({ workspaceId: tenant.workspace._id, newsletterId: tenant.newsletter._id, subject: "Issue 7", format: "markdown", markdown: "x", ...fields });
	const paused = await campaign(a, { status: "paused" });
	const moving = await campaign(a, { status: "sending", subject: "Moving" });
	const stalled = await campaign(b, { status: "sending", subject: "Stalled" });
	await db.models.Campaign.collection.updateOne({ _id: stalled._id }, { $set: { updatedAt: new Date(NOW.getTime() - 3 * 3600_000) } });
	await db.models.Campaign.collection.updateOne({ _id: moving._id }, { $set: { updatedAt: new Date(NOW.getTime() - 5 * 60_000) } });
	await db.models.Campaign.collection.updateOne({ _id: paused._id }, { $set: { updatedAt: new Date(NOW.getTime() - 60 * 60_000) } });
	await messages(b, [{ day: "2026-10-21", count: 3, status: "failed", error: "Mailbox full" }, { day: "2026-09-01", count: 4, status: "failed", error: "ancient" }]);
	await db.models.Message.updateMany({ error: "ancient" }, { $set: { updatedAt: at("2026-09-01") } }, { timestamps: false });
	await db.models.Message.updateMany({ error: "Mailbox full" }, { $set: { updatedAt: new Date(NOW.getTime() - 3600_000) } }, { timestamps: false });
	await db.models.Message.updateMany({ error: "Mailbox full" }, { $set: { updatedAt: new Date(NOW.getTime() - 3600_000) } }, { timestamps: false });

	const problems = await listSendingProblems({ now: NOW });
	assert.deepEqual(problems.map(({ kind, workspaceId }) => [kind, workspaceId]).sort(), [["failed", id(b.workspace)], ["paused", id(a.workspace)], ["stalled", id(b.workspace)]].sort());
	assert.match(problems.find(({ kind }) => kind === "failed").title, /^3 emails failed in 7 days/);
	assert.equal(problems.find(({ kind }) => kind === "failed").detail, "Mailbox full");
	assert.equal(problems.find(({ kind }) => kind === "stalled").detail, "Stalled");
	assert.equal(problems.some(({ detail }) => detail === "Moving"), false, "a send that is moving is fine");
});

test("domains across every client: verified, waiting too long, and SES identities nobody owns", async () => {
	const { listPlatformDomains } = await import("@/lib/platform-domains");
	await db.models.Domain.create({ workspaceId: b.workspace._id, domain: "birch-news.io" });
	await db.models.Domain.collection.updateOne({ domain: "birch-news.io" }, { $set: { createdAt: new Date(NOW.getTime() - 5 * 86_400_000) } });
	await db.models.Domain.collection.updateOne({ domain: "acme.test" }, { $set: { createdAt: new Date(NOW.getTime() - 40 * 86_400_000) } });
	globalThis.__sesDomains = [
		{ domain: "acme.test", verified: true, dkimStatus: "SUCCESS", records: [] },
		{ domain: "birch-news.io", verified: false, dkimStatus: "PENDING", records: [] },
		{ domain: "mail.acme.test", verified: true, dkimStatus: "SUCCESS", records: [] },
		{ domain: "orphan.io", verified: false, dkimStatus: "PENDING", records: [] },
	];
	const { domains, unassigned, sesError } = await listPlatformDomains({ now: NOW });
	assert.equal(sesError, null);
	assert.deepEqual(domains.map(({ domain }) => domain), ["birch-news.io", "birch.test", "acme.test"], "the stuck one first, then the one SES doesn't know yet, the verified last");
	assert.equal(domains[0].isStuck, true);
	assert.equal(domains[0].workspaceName, "Birch");
	assert.equal(domains.find(({ domain }) => domain === "acme.test").isStuck, false);
	assert.equal(domains.find(({ domain }) => domain === "birch.test").status.key, "missing");
	assert.deepEqual(unassigned.map(({ domain }) => domain), ["orphan.io"], "a subdomain of an owned domain is not an orphan");
});

test("the activity log pages through, newest first, and filters by workspace and action", async () => {
	const { listAuditPage } = await import("@/lib/audit");
	const rows = Array.from({ length: 7 }, (_, index) => ({
		workspaceId: index % 2 ? a.workspace._id : b.workspace._id,
		action: index % 3 ? "workspace.limits" : "workspace.suspended",
		actorEmail: "root@platform.test",
		createdAt: new Date(NOW.getTime() - index * 60_000),
	}));
	await db.models.AuditLog.collection.insertMany(rows);

	const first = await listAuditPage({ limit: 3 });
	assert.equal(first.entries.length, 3);
	assert.ok(first.nextBefore);
	const second = await listAuditPage({ limit: 3, before: first.nextBefore });
	assert.equal(second.entries.length, 3);
	const third = await listAuditPage({ limit: 3, before: second.nextBefore });
	assert.equal(third.entries.length, 1);
	assert.equal(third.nextBefore, null);
	const all = [...first.entries, ...second.entries, ...third.entries];
	assert.equal(new Set(all.map(({ id: entryId }) => entryId)).size, 7, "no row twice, none missed");
	assert.deepEqual(all.map(({ at: when }) => +when), [...all.map(({ at: when }) => +when)].sort((x, y) => y - x));

	const acme = await listAuditPage({ workspaceId: id(a.workspace) });
	assert.equal(acme.entries.length, 3);
	assert.ok(acme.entries.every((entry) => entry.workspaceId === id(a.workspace)));
	const suspended = await listAuditPage({ action: "workspace.suspended" });
	assert.equal(suspended.entries.length, 3);
	assert.equal((await listAuditPage({ before: "not a date" })).entries.length, 7, "a bad cursor is ignored");
});
