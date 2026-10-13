// What the "Add contact" dialog tells you after adding one email. An address that opted out, bounced or
// complained is never added back: the import code keeps the stronger status, and this explains why.
export function describeAddResult({ email, created, status }) {
	if (created) return { type: "success", message: `${email} added` };
	if (status === "active") return { type: "info", message: `${email} is already on this list` };
	if (status === "dormant") return { type: "info", message: `${email} is already on this list (dormant)` };
	if (status === "pending") return { type: "info", message: `${email} is waiting to confirm their subscription` };
	if (status === "unsubscribed") return { type: "error", message: `${email} unsubscribed and can't be added again` };
	return { type: "error", message: `${email} is ${status ?? "blocked"} and can't be added again` };
}
