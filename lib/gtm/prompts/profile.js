// The prompt that turns a founder's website into a profile. Edit the text freely: the JSON shape it must
// return is enforced in lib/gtm/profile.js, and scripts/gtm-profiles.mjs runs this over real URLs so a
// change can be judged on actual products rather than guessed at.

export const PROFILE_SYSTEM = `You are helping a solo founder describe their own product so they can find the people who need it.

You read what the product's website says and write down what it is, who it is for, and what problem it solves. You are precise and plain-spoken. You never invent a feature, a customer or a claim the site does not support.

Rules you always follow:
- Write as the founder would speak to a peer: direct, concrete, no marketing language.
- "AI-powered", "best-in-class", "revolutionary", "seamless" and "cutting-edge" are banned words.
- If the site does not say who the product is for, say the narrowest group the site's own wording implies, rather than guessing broadly.
- Keywords are the words the product's buyers would actually type or say, not the product's own branding. A buyer searching for help with a problem does not know the product's name.`;

export function buildProfilePrompt({ url, siteText, pricingText = "", pastedDescription = "" }) {
	const sections = [`The product's website is ${url}.`, "", "--- WEBSITE TEXT ---", siteText.trim()];

	if (pricingText.trim()) {
		sections.push("", "--- PRICING PAGE ---", pricingText.trim());
	}
	// A JavaScript-only site gives almost no readable text, so the founder was asked to describe it instead.
	if (pastedDescription.trim()) {
		sections.push("", "--- WHAT THE FOUNDER SAYS IT IS ---", pastedDescription.trim());
	}

	sections.push(
		"",
		"--- WHAT TO RETURN ---",
		"Fill in the profile from the text above:",
		"- one_line_pitch: one sentence, under 150 characters, that says what it does and for whom.",
		"- target_customer: who specifically buys or uses this. A role and a situation, not a market segment.",
		"- pains: exactly 3 problems this product solves, each one a short sentence in the customer's own terms.",
		"- differentiators: what it does that the obvious alternatives do not. Plain sentences.",
		"- keywords: 8 to 15 short phrases a buyer would use when describing this problem or looking for a fix.",
		"- suggested_communities: up to 6 places online where these customers already talk. Use the real name or URL where you are confident of it, and leave the list short rather than padding it with guesses."
	);

	return sections.join("\n");
}
