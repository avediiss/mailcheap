// The prompt that decides whether a post is worth a founder's reply. Edit the text freely: the JSON shape
// it must return is enforced in lib/gtm/radar-score.js.
//
// This is the only judgement in the radar. Search finds posts containing the right words, and the filter
// removes what no rule needs a model for — but of eight posts that survived both on a live scan, none was
// a person with the problem. They were a comment about phone privacy, a thread about cookie law, someone
// critiquing a landing page. All mentioned the keywords perfectly legitimately. Saying no to those is this
// prompt's entire job, and it has to be comfortable saying no to all of them.

export const SCORE_SYSTEM = `You help a solo founder decide which online posts are worth replying to.

You are shown a product and a handful of posts that mentioned words related to it. You judge each post on one question only: is the person who wrote it someone the founder could genuinely help right now?

Most posts are not. Words about a topic are not a person with a problem. You are expected to score most posts low, and a scan where everything scores low is a correct answer, not a failure.

Score high only when the writer is describing a problem this product solves, asking for a recommendation, or complaining about an alternative they currently use.

Score low when the writer is:
- discussing the topic in general, or arguing about policy, law or ethics
- describing their own project, listing their skills, or advertising something
- an expert explaining something to someone else
- talking about a different problem that happens to share vocabulary
- satisfied with what they already use

Never reward a post for mentioning the product's category. The question is always about the person, not the subject.

Guide to the numbers:
- 80-100: asking for exactly this, right now. A reply would be welcome and useful.
- 60-79: clearly has the problem, though not asking. A helpful reply would fit the conversation.
- 30-59: adjacent. Same area, but replying would be a stretch.
- 0-29: not an opportunity. Most posts belong here.

Your reason is one short sentence, written to the founder, saying what the person actually wants. "Asking which analytics tool to use after leaving GA4." "Arguing about GDPR, not looking for a tool."`;

export function buildScorePrompt({ profile, candidates, maxTextLength = 1200 }) {
	const lines = [
		"--- THE PRODUCT ---",
		`What it is: ${profile?.one_line_pitch ?? ""}`,
		`Who it is for: ${profile?.target_customer ?? ""}`,
		`Problems it solves:${(profile?.pains ?? []).map((pain) => `\n- ${pain}`).join("")}`,
	];

	if (profile?.differentiators) lines.push(`What makes it different: ${profile.differentiators}`);

	lines.push("", "--- THE POSTS ---");
	for (const candidate of candidates) {
		lines.push(
			"",
			`id: ${candidate.externalId}`,
			// What a post is a reply to is often the whole explanation of why it is irrelevant.
			`posted under: ${candidate.contextTitle ?? candidate.storyTitle ?? "(unknown)"}`,
			`found by: ${(candidate.keywords ?? []).join(", ")}`,
			`text: ${String(candidate.text ?? "").slice(0, maxTextLength)}`
		);
	}

	lines.push(
		"",
		"--- WHAT TO RETURN ---",
		"One entry per post above, using its id exactly as given. Each entry is a score from 0 to 100 and one short sentence saying what that person actually wants.",
		"Judge each post on its own. Do not spread the scores out, and do not assume any of them is a good opportunity."
	);

	return lines.join("\n");
}
