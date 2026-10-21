import "server-only";
import { sendAlert } from "@/lib/alerts";
import { NOTICE_WINDOW_MS, describeSignup, getSignupNotice } from "@/lib/signup-notice-rules";
import Contact from "@/models/Contact";

// Emails the workspace's owners when someone subscribes, if the newsletter asks for it (Newsletter settings). Like the
// other alerts it needs ALERT_FROM on a verified domain. Never throws: a failed notice never blocks a signup.
export async function notifyNewSubscriber({ newsletter, contact }) {
	if (!newsletter?.notifyOnSignup || !contact) return;
	try {
		const recent = await Contact.countDocuments({
			newsletterId: newsletter._id,
			createdAt: { $gte: new Date(Date.now() - NOTICE_WINDOW_MS) },
		});
		// Subscriber addresses go to this workspace's owners only, never to the platform owner.
		const audience = { audience: "owners", workspaceId: newsletter.workspaceId };
		const notice = getSignupNotice(recent);
		if (notice === "each") {
			await sendAlert({
				key: `new-subscriber:${contact._id}`,
				title: `New subscriber: ${contact.email}`,
				detail: describeSignup({
					email: contact.email,
					firstName: contact.firstName,
					newsletterName: newsletter.name,
					source: contact.source,
				}),
				path: "/contacts",
				cooldownMinutes: 24 * 60,
				...audience,
			});
		} else if (notice === "burst") {
			await sendAlert({
				key: `signup-burst:${newsletter.slug}`,
				title: `Many signups on ${newsletter.name}`,
				detail: "Several people subscribed in the last 10 minutes. You get this one email instead of one each. If it looks like bots, turn on Confirm new signups.",
				path: "/contacts",
				...audience,
			});
		}
	} catch (error) {
		console.error("[signup-notice] Could not notify:", error?.message);
	}
}
