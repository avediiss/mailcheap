// Nothing reaches QStash: what a send would have queued is recorded, with the delay each request asked for.
export function qstashCalls() {
	return (globalThis.__qstashCalls ??= []);
}

export class Client {
	async batchJSON(requests) {
		qstashCalls().push(...requests.map((request) => ({ ...request, via: "batchJSON" })));
		return requests.map(() => ({ messageId: "stub" }));
	}

	async publishJSON(request) {
		qstashCalls().push({ ...request, via: "publishJSON" });
		return { messageId: "stub" };
	}
}
