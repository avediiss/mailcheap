import assert from "node:assert/strict";
import { test } from "node:test";
import { buildActivity, describeMessage, getEngagement } from "../lib/contact-activity.js";

const at = (day, hour = 10) => new Date(`2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);

test("an email's life shows as events, newest first, named after what it was", () => {
	const campaignSubjects = new Map([["c1", "Field notes #14"]]);
	const messages = [
		{ _id: "m1", kind: "campaign", campaignId: "c1", sentAt: at(20, 9), deliveredAt: at(20, 9), openedAt: at(20, 12), clickedAt: at(21, 8) },
		{ _id: "m2", kind: "welcome", sentAt: at(10, 9) },
		{ _id: "m3", kind: "sequence", step: 1, sentAt: at(12, 9), bouncedAt: at(12, 10) },
		{ _id: "m4", kind: "last-chance", sentAt: at(22, 9), status: "failed", error: "Mailbox full", updatedAt: at(22, 9) },
	];
	const events = buildActivity({ contact: { subscribedAt: at(9), confirmedAt: at(9, 11) }, messages, campaignSubjects });
	assert.deepEqual(events.map(({ type, title }) => `${type}: ${title}`), [
		"failed: Last-chance email",
		"sent: Last-chance email",
		"clicked: Field notes #14",
		"opened: Field notes #14",
		"delivered: Field notes #14",
		"sent: Field notes #14",
		"bounced: Series email 2",
		"sent: Series email 2",
		"sent: Welcome email",
		"confirmed: Confirmed their subscription",
		"subscribed: Joined the list",
	].map((line) => line.replace("confirmed: Confirmed their subscription", "confirmed: Confirmed their subscription")));
	assert.equal(events.find(({ type }) => type === "failed").detail, "Mailbox full");
});

test("leaving is named for how it happened, and an unknown campaign still has a name", () => {
	const left = (status) => buildActivity({ contact: { subscribedAt: at(1), unsubscribedAt: at(5), status } }).find(({ type }) => type === "left").title;
	assert.equal(left("unsubscribed"), "Unsubscribed");
	assert.equal(left("bounced"), "Left after a bounce");
	assert.equal(left("complained"), "Left after a spam complaint");
	assert.equal(describeMessage({ kind: "campaign", campaignId: "gone" }), "An issue");
	assert.equal(describeMessage({ kind: "mystery" }), "An email");
});

test("the list is capped, ignores broken dates, and nothing means nothing", () => {
	assert.deepEqual(buildActivity({ contact: {} }), []);
	assert.deepEqual(buildActivity({ contact: { subscribedAt: "not a date" } }), []);
	const messages = Array.from({ length: 100 }, (_, index) => ({ _id: `m${index}`, kind: "welcome", sentAt: at(1 + (index % 20), index % 24) }));
	assert.equal(buildActivity({ contact: {}, messages }).length, 60);
	assert.equal(buildActivity({ contact: {}, messages, limit: 5 }).length, 5);
});

test("engagement is the opens and clicks of the emails sent, never over 100%", () => {
	assert.deepEqual(getEngagement({ sent: 10, opens: 4, clicks: 1 }), { sent: 10, opens: 4, clicks: 1, openRate: 0.4, clickRate: 0.1 });
	assert.equal(getEngagement({ sent: 2, opens: 5 }).openRate, 1, "a reader who opens twice");
	assert.deepEqual(getEngagement(), { sent: 0, opens: 0, clicks: 0, openRate: null, clickRate: null });
});
