import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

// What can't run outside Next, or must not reach AWS, is swapped for a stand-in. Everything else is the real code.
const STUBS = {
	"next/headers": "stubs/next-headers.mjs",
	"next/cache": "stubs/next-cache.mjs",
	"next/navigation": "stubs/next-navigation.mjs",
	"next/server": "stubs/next-server.mjs",
	"@/lib/ses": "stubs/ses.mjs",
	"@upstash/qstash": "stubs/qstash.mjs",
};
const EXTENSIONS = ["", ".js", ".jsx", "/index.js"];

export async function resolve(specifier, context, nextResolve) {
	if (STUBS[specifier]) return { url: pathToFileURL(path.join(here, STUBS[specifier])).href, shortCircuit: true };
	if (specifier.startsWith("@/")) {
		const base = path.join(root, specifier.slice(2));
		for (const extension of EXTENSIONS) {
			const candidate = base + extension;
			if (existsSync(candidate) && statSync(candidate).isFile()) {
				return nextResolve(pathToFileURL(candidate).href, context);
			}
		}
	}
	return nextResolve(specifier, context);
}
