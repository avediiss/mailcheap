import assert from "node:assert/strict";
import { test } from "node:test";
import {
	MIN_SAMPLE_PER_VARIANT,
	assignVariant,
	getAbVerdict,
	isAbTest,
	summarizeVariants,
	withVariantSubject,
} from "../lib/ab-test.js";
import { buildAudienceQuery, describeSegment, hasRestrictedAudience, normalizeSegment, selectAudience } from "../lib/audience.js";
import { buildNonOpenersFilter } from "../lib/non-openers.js";

const newsletterId = "74f1a2b3c4d5e6f7a8b9c0d2";

test("a segment narrows the audience by tag and signup source", () => {
	const { filter } = buildAudienceQuery({ newsletterId, segment: { tag: " VIP ", source: "website" } });
	assert.deepEqual(filter, { newsletterId, status: "active", tags: "vip", source: "website" });
	assert.deepEqual(buildAudienceQuery({ newsletterId, segment: {} }).filter, { newsletterId, status: "active" });
	assert.deepEqual(buildAudienceQuery({ newsletterId, segment: undefined }).filter, { newsletterId, status: "active" });
});

test("picking contacts by id restricts the audience to them", () => {
	const { filter } = buildAudienceQuery({ newsletterId, onlyContactIds: ["a", "b"] });
	assert.deepEqual(filter._id, { $in: ["a", "b"] });
	assert.deepEqual(buildAudienceQuery({ newsletterId, onlyContactIds: [] }).filter._id, { $in: [] });
});

test("the in-memory audience selection follows the same segment rules", () => {
	const contacts = [
		{ _id: "1", email: "a@x.co", status: "active", tags: ["vip"], source: "website", createdAt: new Date(1) },
		{ _id: "2", email: "b@x.co", status: "active", tags: [], source: "website", createdAt: new Date(2) },
		{ _id: "3", email: "c@x.co", status: "unsubscribed", tags: ["vip"], source: "website", createdAt: new Date(3) },
	];
	assert.deepEqual(selectAudience(contacts, { segment: { tag: "vip" } }).map(({ _id }) => _id), ["1"]);
	assert.deepEqual(selectAudience(contacts, { segment: { source: "website" } }).map(({ _id }) => _id), ["1", "2"]);
	assert.equal(selectAudience(contacts).length, 2);
});

test("segments are described, and only a part of the list counts as restricted", () => {
	assert.deepEqual(normalizeSegment({ tag: "  ", source: "" }), {});
	assert.equal(describeSegment(undefined), "Everyone");
	assert.equal(describeSegment({ tag: "vip" }), "Tagged vip");
	assert.equal(describeSegment({ tag: "vip", source: "website" }), "Tagged vip · from website");
	assert.equal(hasRestrictedAudience(undefined), false);
	assert.equal(hasRestrictedAudience({}), false);
	assert.equal(hasRestrictedAudience({ tag: "vip" }), true);
	assert.equal(hasRestrictedAudience({ nonOpenersOf: "abc" }), true);
});

test("non-openers are people who got the issue and neither opened nor clicked it", () => {
	const filter = buildNonOpenersFilter("c1");
	assert.equal(filter.campaignId, "c1");
	assert.equal(filter.kind, "campaign");
	assert.deepEqual(filter.sentAt, { $ne: null });
	assert.equal(filter.openedAt, null);
	assert.equal(filter.clickedAt, null);
	assert.deepEqual(filter.status.$nin, ["bounced", "complained", "failed"]);
});

test("an A/B test alternates subjects down the list, continuing where the last step stopped", () => {
	const campaign = { subject: "A one", subjectB: "B one" };
	assert.equal(isAbTest(campaign), true);
	assert.equal(isAbTest({ subject: "x" }), false);
	assert.equal(isAbTest({ subject: "x", subjectB: "   " }), false);
	assert.deepEqual([0, 1, 2, 3].map((index) => assignVariant({ campaign, index })), ["A", "B", "A", "B"]);
	assert.deepEqual([0, 1].map((index) => assignVariant({ campaign, index, offset: 3 })), ["B", "A"]);
	assert.equal(assignVariant({ campaign: { subject: "x" }, index: 0 }), null);
});

test("once a winner is picked, everyone after gets its subject", () => {
	const campaign = { subject: "A one", subjectB: "B one", abWinner: "B" };
	assert.deepEqual([0, 1, 2].map((index) => assignVariant({ campaign, index })), ["B", "B", "B"]);
	assert.equal(withVariantSubject(campaign, "B").subject, "B one");
	assert.equal(withVariantSubject(campaign, "A").subject, "A one");
	assert.equal(withVariantSubject(campaign, undefined).subject, "A one");
	assert.equal(withVariantSubject({ subject: "x" }, "B").subject, "x", "no second subject, no swap");
});

test("variant results: small samples and close races aren't called", () => {
	const summaries = summarizeVariants([
		{ variant: "A", sent: 100, delivered: 100, opened: 40, clicked: 5 },
		{ variant: "B", sent: 100, delivered: 98, opened: 20, clicked: 2 },
	]);
	assert.equal(summaries[0].openRate, 0.4);
	assert.equal(getAbVerdict(summaries).leader, "A");

	const small = summarizeVariants([
		{ variant: "A", sent: 10, delivered: 10, opened: 9 },
		{ variant: "B", sent: 10, delivered: 10, opened: 1 },
	]);
	assert.deepEqual(getAbVerdict(small), { leader: null, reason: "small-sample" });
	assert.ok(MIN_SAMPLE_PER_VARIANT > 10);

	const close = summarizeVariants([
		{ variant: "A", sent: 200, delivered: 200, opened: 80 },
		{ variant: "B", sent: 200, delivered: 200, opened: 82 },
	]);
	assert.deepEqual(getAbVerdict(close), { leader: null, reason: "too-close" });

	const behind = summarizeVariants([
		{ variant: "A", sent: 200, delivered: 200, opened: 60 },
		{ variant: "B", sent: 200, delivered: 200, opened: 100 },
	]);
	assert.equal(getAbVerdict(behind).leader, "B");
	assert.equal(summarizeVariants([]).length, 2, "both variants always listed");
});
