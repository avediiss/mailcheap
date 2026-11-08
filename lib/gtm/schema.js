// Every model the module owns, in dependency order. Used by the tests to create the indexes and clear the
// collections, and by anything that needs to know the module's whole footprint in one place — including
// whoever eventually removes it: these eleven collections are all it leaves behind.
export const GTM_MODEL_NAMES = [
	"Product",
	"OnboardingInterview",
	"WatchedSource",
	"VoiceSample",
	"Opportunity",
	"Draft",
	"Action",
	"Link",
	"Click",
	"Signup",
	"AiUsage",
];

// models/gtm/<name>.js -> the gtm_* collection it writes to.
export const GTM_COLLECTIONS = {
	Product: "gtm_products",
	OnboardingInterview: "gtm_onboarding_interviews",
	WatchedSource: "gtm_watched_sources",
	VoiceSample: "gtm_voice_samples",
	Opportunity: "gtm_opportunities",
	Draft: "gtm_drafts",
	Action: "gtm_actions",
	Link: "gtm_links",
	Click: "gtm_clicks",
	Signup: "gtm_signups",
	AiUsage: "gtm_ai_usage",
};
