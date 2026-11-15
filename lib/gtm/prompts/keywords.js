// How the radar's keywords must be written. Edit the text freely. It is shared by the profile prompt and
// the refinement prompt, so the interview can never quietly bring back the kind of keyword this replaced.
//
// Why it reads the way it does — measured, not guessed:
// - A keyword matches a post only when every one of its words appears in it (lib/gtm/sources/match.js).
//   Long keywords therefore match almost nothing.
// - Category nouns ("ga4 alternative", "eu hosted analytics") find vendors, comparison articles and people
//   explaining the topic. Fourteen of them, generated for a privacy-analytics product, found 93 posts on
//   Hacker News and Bluesky in a month and not one person who needed the product.
// - The one person who did wrote "Recommendations for analytics that isn't the big G?" — no product name,
//   no category term. Only a help-seeking phrase, "analytics recommendations", found it.
//
// The examples below are deliberately from a different product, so the rules teach a style rather than
// leak the answer for the one product they were measured on.

export const KEYWORD_RULES = `How keywords work. Keywords decide which public posts the founder is shown. A post matches a keyword only when it contains every word of that keyword, in any order. Write them for that:
- Two or three words each, never more. A four-word keyword almost never appears whole in a real post.
- Each keyword pairs a word for the problem area with a word people use when they want help or are unhappy with what they have: recommendations, recommend, suggestions, alternative, instead, switch, switching, replace, anyone, hate, frustrated, confusing, struggling, expensive.
- Write them as a person types a question to strangers, not as the product's website describes itself. People in trouble rarely name the category; they describe their situation, and often refer to the tool they are leaving by a nickname or not at all.
- Avoid words that sellers and writers use far more than buyers do: "privacy-friendly", "GDPR-compliant", "open source", "lightweight", "best", "top", "solution", "platform". Those find vendors and comparison articles, not people.
- Never the product's own name. A competitor's name only when paired with a sign of trouble ("quickbooks expensive", not "quickbooks").
- Common words only. A keyword is useful only if real people actually write those words.

For an invoicing tool for freelancers, good keywords look like: "invoicing recommendations", "invoice software suggestions", "chasing late payments", "clients paying late", "quickbooks alternative", "quickbooks expensive", "hate invoicing". Bad ones look like: "automated invoicing solution", "freelance accounting platform", "best invoicing software for freelancers".`;
