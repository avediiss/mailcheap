// after() callbacks are collected: a test awaits flushAfter() to run what a real request runs once it answers.
export function after(task) {
	(globalThis.__afterTasks ??= []).push(task);
}

export async function flushAfter() {
	const tasks = globalThis.__afterTasks ?? [];
	globalThis.__afterTasks = [];
	for (const task of tasks) await (typeof task === "function" ? task() : task);
}

export class NextResponse extends Response {
	static json(body, init) {
		return Response.json(body, init);
	}

	static next() {
		return new Response(null, { headers: { "x-test-next": "1" } });
	}

	static redirect(url, status = 307) {
		return Response.redirect(String(url), status);
	}
}

export class NextRequest extends Request {}
