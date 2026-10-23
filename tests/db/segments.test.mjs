import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { loginAs, makeTenant, startDb } from "./helpers.mjs";

let db;
let a;
let b;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	const { clearSendPlanCache } = await import("@/lib/send-plan-server");
	clearSendPlanCache();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
	await db.models.Workspace.updateMany({}, { $set: { sendingTrust: { isTrusted: true } } });
	await db.models.Contact.deleteMany({});
});

const id = (doc) => String(doc._id);
const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY);

async function people() {
	const rows = [
		{ email: "vip-recent@x.test", tags: ["vip"], lastOpenAt: ago(3), fields: { plan: "Pro", seats: 20, renews: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10) } },
		{ email: "vip-cold@x.test", tags: ["vip"], lastOpenAt: ago(120) },
		{ email: "plain-recent@x.test", tags: [], lastOpenAt: ago(5), fields: { plan: "Free", seats: 2 } },
		{ email: "never@x.test", tags: ["press"], source: "import" },
		{ email: "gone@x.test", tags: ["vip"], status: "unsubscribed", lastOpenAt: ago(1) },
	];
	await db.models.Contact.insertMany(
		rows.map((row) => ({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id, status: "active", source: "website", lastSentAt: ago(30), ...row }))
	);
	await db.models.ContactField.insertMany([
		{ workspaceId: a.workspace._id, key: "plan", label: "Plan", type: "text" },
		{ workspaceId: a.workspace._id, key: "seats", label: "Seats", type: "number" },
		{ workspaceId: a.workspace._id, key: "renews", label: "Renews", type: "date" },
	]);
}

async function save(input) {
	const { saveSegment } = await import("@/app/(app)/contacts/actions");
	return saveSegment({ newsletterId: id(a.newsletter), ...input });
}

test("a segment is saved with checked rules, counted live, edited and deleted, inside its workspace", async () => {
	await people();
	const { countSegmentRules, removeSegment } = await import("@/app/(app)/contacts/actions");
	const { listSegmentsWithCounts } = await import("@/lib/segments-server");
	await loginAs(a.owner);

	const rules = { name: "Engaged VIPs", match: "all", conditions: [{ field: "tag", op: "has", value: "VIP" }, { field: "opened", op: "inLast", value: "30" }] };
	assert.deepEqual(await countSegmentRules({ newsletterId: id(a.newsletter), ...rules }), { count: 1 });
	assert.deepEqual(await save(rules), { ok: true });
	assert.deepEqual(await countSegmentRules({ newsletterId: id(a.newsletter), ...rules, match: "any" }), { count: 3 });

	const [segment] = await listSegmentsWithCounts({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id });
	assert.equal(segment.name, "Engaged VIPs");
	assert.equal(segment.count, 1);
	assert.deepEqual(segment.conditions[0], { field: "tag", op: "has", value: "vip" }, "tags are lowercase");

	assert.deepEqual(await save({ ...rules, id: segment.id, name: "Anyone warm", match: "any" }), { ok: true });
	assert.equal((await listSegmentsWithCounts({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id }))[0].count, 3);

	assert.match((await save({ name: "x", conditions: [] })).error, /at least one rule/);
	assert.match((await save({ name: "x", conditions: [{ field: "opened", op: "inLast", value: "soon" }] })).error, /number of days/);
	assert.match((await save({ name: "x", conditions: [{ field: "field:gone", op: "is", value: "1" }] })).error, /doesn't exist/);

	// Another workspace can't see, count, edit or delete it, and its newsletter isn't theirs to make one on.
	await loginAs(b.owner);
	assert.equal((await removeSegment(segment.id)).error, "Segment not found");
	assert.equal((await countSegmentRules({ newsletterId: id(a.newsletter), ...rules })).error, "Newsletter not found");
	const { saveSegment } = await import("@/app/(app)/contacts/actions");
	assert.equal((await saveSegment({ id: segment.id, newsletterId: id(b.newsletter), ...rules })).error, "Segment not found");
	assert.equal(await db.models.Segment.countDocuments({ workspaceId: a.workspace._id }), 1);

	await loginAs(a.owner);
	assert.deepEqual(await removeSegment(segment.id), { ok: true });
	assert.equal(await db.models.Segment.countDocuments(), 0);
});

test("rules over custom fields: text, numbers, and dates, including renewals coming up", async () => {
	await people();
	const { countSegmentRules } = await import("@/app/(app)/contacts/actions");
	await loginAs(a.owner);
	const count = async (conditions, match = "all") => (await countSegmentRules({ newsletterId: id(a.newsletter), match, conditions })).count;
	assert.equal(await count([{ field: "field:plan", op: "is", value: "Pro" }]), 1);
	assert.equal(await count([{ field: "field:plan", op: "isNotSet" }]), 2, "no value at all");
	assert.equal(await count([{ field: "field:seats", op: "greaterThan", value: "10" }]), 1);
	assert.equal(await count([{ field: "field:renews", op: "inNext", value: "30" }]), 1);
	assert.equal(await count([{ field: "field:renews", op: "inNext", value: "5" }]), 0);
	assert.equal(await count([{ field: "source", op: "is", value: "import" }]), 1);
	assert.equal(await count([{ field: "email", op: "endsWith", value: "@x.test" }]), 4, "active contacts only: the one who left is never in a segment");
	assert.equal(await count([{ field: "opened", op: "never" }]), 1);
	assert.equal(await count([{ field: "opened", op: "notInLast", value: "30" }]), 2, "cold or never");
});

test("an issue can go to a saved segment: only those people, with the segment's rules applied when it goes", async () => {
	await people();
	await loginAs(a.owner);
	await save({ name: "Engaged VIPs", match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }, { field: "opened", op: "inLast", value: "30" }] });
	const segment = await db.models.Segment.findOne();
	const { setCampaignAudience } = await import("@/app/(app)/campaigns/actions");
	const { countAudience } = await import("@/lib/campaign-audience");
	const { queueCampaign } = await import("@/lib/sending");

	assert.deepEqual(await setCampaignAudience(id(a.campaign), { segmentId: id(segment) }), { ok: true });
	assert.equal(await countAudience(await db.models.Campaign.findById(a.campaign._id).lean()), 1);

	// A person who starts to qualify later is included when it goes out: the segment is a question, not a list.
	await db.models.Contact.updateOne({ email: "vip-cold@x.test" }, { $set: { lastOpenAt: ago(1) } });
	const result = await queueCampaign(id(a.campaign));
	assert.equal(result.recipients, 2);
	const sentTo = (await db.models.Message.find({ campaignId: a.campaign._id })).map(({ email }) => email).sort();
	assert.deepEqual(sentTo, ["vip-cold@x.test", "vip-recent@x.test"]);
});

test("if the segment is deleted the issue asks again instead of going to everyone", async () => {
	await people();
	await loginAs(a.owner);
	await save({ name: "VIPs", match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }] });
	const segment = await db.models.Segment.findOne();
	const { setCampaignAudience, scheduleCampaign } = await import("@/app/(app)/campaigns/actions");
	const { removeSegment } = await import("@/app/(app)/contacts/actions");
	const { countAudience } = await import("@/lib/campaign-audience");
	const { queueCampaign } = await import("@/lib/sending");
	await setCampaignAudience(id(a.campaign), { segmentId: id(segment) });
	await removeSegment(id(segment));

	await assert.rejects(queueCampaign(id(a.campaign)), /segment chosen for this issue was deleted/);
	assert.equal(await db.models.Message.countDocuments({ campaignId: a.campaign._id }), 0, "nothing was queued");
	assert.equal(await countAudience(await db.models.Campaign.findById(a.campaign._id).lean()), 0);
	const scheduled = await scheduleCampaign(id(a.campaign), { scheduledAt: new Date(Date.now() + 2 * DAY).toISOString() });
	assert.match(scheduled.error, /was deleted/);
});

test("a campaign can only use a segment of its own newsletter and workspace", async () => {
	await people();
	await loginAs(b.owner);
	const { saveSegment } = await import("@/app/(app)/contacts/actions");
	await saveSegment({ newsletterId: id(b.newsletter), name: "Birch VIPs", conditions: [{ field: "tag", op: "has", value: "vip" }] });
	const theirs = await db.models.Segment.findOne({ workspaceId: b.workspace._id });
	await loginAs(a.owner);
	const { setCampaignAudience } = await import("@/app/(app)/campaigns/actions");
	assert.equal((await setCampaignAudience(id(a.campaign), { segmentId: id(theirs) })).error, "Segment not found");
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).audience?.segmentId, undefined);
});

test("the contacts list and export can be filtered by a segment", async () => {
	await people();
	await loginAs(a.owner);
	await save({ name: "VIPs", match: "all", conditions: [{ field: "tag", op: "has", value: "vip" }] });
	const segment = await db.models.Segment.findOne();
	const { GET } = await import("@/app/api/contacts-export/route");
	const text = await (await GET(new Request(`https://mailcheap.test/api/contacts-export?segment=${id(segment)}`))).text();
	const lines = text.replace(/^﻿/, "").trim().split("\r\n").slice(1);
	assert.deepEqual(lines.map((line) => line.split(",")[0]).sort(), ["gone@x.test", "vip-cold@x.test", "vip-recent@x.test"], "the list view includes every status; the status filter narrows it");
	assert.equal((await GET(new Request(`https://mailcheap.test/api/contacts-export?segment=${id(segment)}&status=active`))).status, 200);

	await loginAs(b.owner);
	assert.equal((await GET(new Request(`https://mailcheap.test/api/contacts-export?segment=${id(segment)}`))).status, 404, "another workspace's segment finds nothing");
});
