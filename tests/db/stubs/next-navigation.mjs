// Like Next: a redirect or a 404 is an exception that stops the page or action.
export function redirect(url) {
	const error = new Error(`NEXT_REDIRECT:${url}`);
	error.digest = `NEXT_REDIRECT;replace;${url}`;
	error.redirectTo = url;
	throw error;
}

export function notFound() {
	const error = new Error("NEXT_NOT_FOUND");
	error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
	throw error;
}
