// One fake request at a time: tests set cookies and headers on it (helpers.mjs loginAs).
export function currentRequest() {
	globalThis.__testRequest ??= { cookies: new Map(), headers: new Map() };
	return globalThis.__testRequest;
}

export async function cookies() {
	const jar = currentRequest().cookies;
	return {
		get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
		has: (name) => jar.has(name),
		set: (nameOrOptions, value) => {
			if (typeof nameOrOptions === "object") jar.set(nameOrOptions.name, nameOrOptions.value);
			else jar.set(nameOrOptions, value);
		},
		delete: (nameOrOptions) => jar.delete(typeof nameOrOptions === "object" ? nameOrOptions.name : nameOrOptions),
	};
}

export async function headers() {
	return new Headers([...currentRequest().headers.entries()]);
}
