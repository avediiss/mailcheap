// What "matched" means, once, for every platform the radar reads itself.
//
// Every word of a keyword must appear somewhere in the post, in any order — an AND, not a phrase. It is
// the rule the Hacker News search applies server-side once typo tolerance is off, measured as the one
// that finds real posts without drowning in loose ones. Platforms whose own search is looser (Bluesky
// returns posts missing a word about a quarter of the time) are held to it here, so a keyword means the
// same thing wherever it is searched.
export function matchingKeywords(text, keywords = []) {
	const haystack = String(text ?? "").toLowerCase();
	return keywords.filter((keyword) => {
		const words = String(keyword ?? "")
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		return words.length > 0 && words.every((word) => haystack.includes(word));
	});
}
