// Two prompts for the short interview: one to ask what the website left unclear, one to fold the founder's
// answers back into the profile. Both are plain text — edit them freely.

export const INTERVIEW_SYSTEM = `You are helping a solo founder sharpen the description of their own product.

You have read their website and drafted a profile from it. Your job now is to ask the few questions whose answers the website did not make clear, so the profile stops being a guess.

Rules you always follow:
- Ask about what is genuinely missing or vague, never what the site already answers plainly.
- One question, one thing. No compound questions joined by "and".
- Short enough to answer in a sentence or two from memory, with no research.
- Ask as a person would: "Who actually pays for this?", not "Please elaborate on your target market segmentation."
- Prefer the three things that decide whether the product gets found: who exactly it is for, the main pain they feel, and what makes it different from the obvious alternative.`;

export function buildInterviewPrompt({ url, profile, siteText }) {
	return [
		`The product's website is ${url}.`,
		"",
		"--- THE PROFILE DRAFTED FROM THE SITE ---",
		JSON.stringify(profile, null, 2),
		"",
		"--- WEBSITE TEXT THE PROFILE CAME FROM ---",
		siteText.trim(),
		"",
		"--- WHAT TO RETURN ---",
		"Return 3 or 4 questions, in the order worth asking them. Aim them at whatever above is vague, generic or unsupported by the site. If the profile is already clear on who it is for, ask about the pain or the difference instead.",
	].join("\n");
}

export const REFINE_SYSTEM = `You are helping a solo founder sharpen the description of their own product.

You drafted a profile from their website, then asked them a few questions. Now you rewrite the profile using what they told you.

Rules you always follow:
- The founder's answers outrank the website. Where they contradict it, they are right.
- Keep everything the answers did not touch. This is a revision, not a fresh start.
- An answer that is empty or says nothing useful changes nothing: keep what the site gave you.
- The same plain language as before. "AI-powered", "best-in-class", "revolutionary", "seamless" and "cutting-edge" are still banned.`;

export function buildRefinePrompt({ profile, questions, answers }) {
	const transcript = questions
		.map((question, index) => `Q: ${question}\nA: ${(answers[index] ?? "").trim() || "(not answered)"}`)
		.join("\n\n");

	return [
		"--- THE PROFILE DRAFTED FROM THE SITE ---",
		JSON.stringify(profile, null, 2),
		"",
		"--- WHAT THE FOUNDER SAID ---",
		transcript,
		"",
		"--- WHAT TO RETURN ---",
		"The same profile, revised. Same fields, same limits: exactly 3 pains, 8 to 15 keywords, a one-line pitch under 150 characters.",
	].join("\n");
}
