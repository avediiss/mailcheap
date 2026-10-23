// What happened to one contact, newest first: when they joined, confirmed or left, and what each email did
// (sent, delivered, opened, clicked, bounced, marked as spam, failed). Pure: the page gathers the rows.

export const MAX_ACTIVITY = 60;

const KIND_TITLES = {
	"last-chance": "Last-chance email",
	welcome: "Welcome email",
	confirmation: "Confirmation email",
};

export function describeMessage(message, campaignSubjects = new Map()) {
	if (message.kind === "campaign") return campaignSubjects.get(String(message.campaignId)) || "An issue";
	if (message.kind === "sequence") return `Series email ${(message.step ?? 0) + 1}`;
	return KIND_TITLES[message.kind] ?? "An email";
}

const MESSAGE_EVENTS = [
	["sentAt", "sent"],
	["deliveredAt", "delivered"],
	["openedAt", "opened"],
	["clickedAt", "clicked"],
	["bouncedAt", "bounced"],
	["complainedAt", "complained"],
];

// contact: { subscribedAt, confirmedAt, unsubscribedAt, status }. messages: the contact's messages (test emails
// have no contact). campaignSubjects: Map of campaign id -> subject.
export function buildActivity({ contact, messages = [], campaignSubjects = new Map(), limit = MAX_ACTIVITY }) {
	const events = [];
	if (contact.subscribedAt) events.push({ type: "subscribed", at: contact.subscribedAt, title: "Joined the list" });
	if (contact.confirmedAt) events.push({ type: "confirmed", at: contact.confirmedAt, title: "Confirmed their subscription" });
	if (contact.unsubscribedAt) {
		const title = { unsubscribed: "Unsubscribed", bounced: "Left after a bounce", complained: "Left after a spam complaint" }[contact.status] ?? "Unsubscribed";
		events.push({ type: "left", at: contact.unsubscribedAt, title });
	}
	for (const message of messages) {
		const title = describeMessage(message, campaignSubjects);
		for (const [field, type] of MESSAGE_EVENTS) {
			if (message[field]) events.push({ type, at: message[field], title, messageId: String(message._id) });
		}
		if (message.status === "failed") events.push({ type: "failed", at: message.updatedAt ?? message.createdAt, title, detail: message.error });
	}
	return events
		.filter(({ at }) => at && !Number.isNaN(new Date(at).getTime()))
		.toSorted((a, b) => new Date(b.at) - new Date(a.at) || EVENT_ORDER.indexOf(b.type) - EVENT_ORDER.indexOf(a.type))
		.slice(0, limit);
}

// On the same instant, the later step of an email's life shows above the earlier one.
const EVENT_ORDER = ["subscribed", "confirmed", "sent", "delivered", "opened", "clicked", "failed", "bounced", "complained", "left"];

export const EVENT_VERBS = {
	subscribed: "Joined",
	confirmed: "Confirmed",
	left: "Left",
	sent: "Sent",
	delivered: "Delivered",
	opened: "Opened",
	clicked: "Clicked",
	bounced: "Bounced",
	complained: "Marked as spam",
	failed: "Failed",
};

// What the contact has done with the emails they got, as rates of the ones sent.
export function getEngagement(stats = {}) {
	const sent = stats.sent ?? 0;
	return {
		sent,
		opens: stats.opens ?? 0,
		clicks: stats.clicks ?? 0,
		openRate: sent ? Math.min(1, (stats.opens ?? 0) / sent) : null,
		clickRate: sent ? Math.min(1, (stats.clicks ?? 0) / sent) : null,
	};
}
