// Nothing reaches QStash: what a send would have queued is recorded, with the delay each request asked for.
export function qstashCalls() {
	return (globalThis.__qstashCalls ??= []);
}

// Recurring schedules (the GTM agent's radar scan) are kept by id, so creating the same one twice replaces
// it here exactly as it would at QStash.
export function qstashSchedules() {
	return (globalThis.__qstashSchedules ??= new Map());
}

export class Client {
	schedules = {
		async create(request) {
			const scheduleId = request.scheduleId ?? `stub-${qstashSchedules().size + 1}`;
			const method = request.method ?? "POST";
			qstashSchedules().set(scheduleId, { ...request, scheduleId, method, createdAt: Date.now(), isPaused: false });
			return { scheduleId };
		},

		async list() {
			return [...qstashSchedules().values()];
		},

		async get(scheduleId) {
			return qstashSchedules().get(scheduleId) ?? null;
		},

		async delete(scheduleId) {
			qstashSchedules().delete(scheduleId);
		},
	};

	async batchJSON(requests) {
		qstashCalls().push(...requests.map((request) => ({ ...request, via: "batchJSON" })));
		return requests.map(() => ({ messageId: "stub" }));
	}

	async publishJSON(request) {
		qstashCalls().push({ ...request, via: "publishJSON" });
		return { messageId: "stub" };
	}
}
