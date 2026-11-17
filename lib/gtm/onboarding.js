import "server-only";
import { connectDb } from "@/lib/db";
import { askForJson } from "@/lib/gtm/ai";
import { GTM_LIMITS } from "@/lib/gtm/config";
import { readWatchedSources } from "@/lib/gtm/platforms";
import {
	INTERVIEW_JSON_SCHEMA,
	PROFILE_JSON_SCHEMA,
	fromProductFields,
	readInterviewQuestions,
	readProfile,
	toProductFields,
} from "@/lib/gtm/profile";
import { INTERVIEW_SYSTEM, REFINE_SYSTEM, buildInterviewPrompt, buildRefinePrompt } from "@/lib/gtm/prompts/interview";
import { PROFILE_SYSTEM, buildProfilePrompt } from "@/lib/gtm/prompts/profile";
import { readSite } from "@/lib/gtm/site-reader";
import { readVoiceSamples } from "@/lib/gtm/voice-samples";
import GtmOnboardingInterview from "@/models/gtm/OnboardingInterview";
import GtmProduct from "@/models/gtm/Product";
import GtmVoiceSample from "@/models/gtm/VoiceSample";
import GtmWatchedSource from "@/models/gtm/WatchedSource";

// The six onboarding steps, as the server sees them. Each one saves before it returns, so a founder who
// closes the tab comes back to where they were (gtm_products.onboardingStatus). Nothing here reads the
// session or redirects: the server actions in app/(app)/gtm do that and call these.

// Onboarding only moves forward. A founder re-reading their site after finishing shouldn't be sent back
// to step one, so a status is only written when it is further along than the one already stored.
const STATUS_ORDER = ["new", "site_read", "interviewed", "profile_reviewed", "sources_added", "ready"];

export function furthestStatus(current, next) {
	const currentIndex = STATUS_ORDER.indexOf(current ?? "new");
	const nextIndex = STATUS_ORDER.indexOf(next);
	return nextIndex > currentIndex ? next : (current ?? "new");
}

export async function getProduct(workspaceId) {
	await connectDb();
	return GtmProduct.findOne({ workspaceId }).lean();
}

// Step 1. Reads the site and extracts a profile. The product row is created on the way in, so a site that
// can't be read still leaves the founder something to come back to.
export async function readSiteAndExtractProfile({ workspaceId, userId, url, pastedDescription = "" }) {
	await connectDb();

	const site = await readSite(url);
	if (site.error) return { error: site.error };

	const { siteText, pricingText, needsDescription, title, pricingUrl } = site.value;
	// Nothing readable and nothing pasted: ask the founder instead of sending the AI a navigation bar.
	if (needsDescription && !pastedDescription.trim()) {
		await saveSiteRead({ workspaceId, userId, site: site.value, name: title });
		return { needsDescription: true, url: site.value.url, textLength: site.value.textLength };
	}

	const product = await saveSiteRead({ workspaceId, userId, site: site.value, name: title });

	const profile = await askForJson({
		workspaceId,
		productId: product._id,
		purpose: "profile_extract",
		system: PROFILE_SYSTEM,
		prompt: buildProfilePrompt({ url: site.value.url, siteText, pricingText, pastedDescription }),
		schema: PROFILE_JSON_SCHEMA,
		read: readProfile,
	});
	if (profile.error) return { error: profile.error, url: site.value.url };

	await GtmProduct.updateOne(
		{ _id: product._id },
		{ $set: { ...toProductFields(profile.value), onboardingStatus: furthestStatus(product.onboardingStatus, "site_read") } }
	);

	return { profile: profile.value, suggestedCommunities: profile.value.suggested_communities, url: site.value.url, pricingUrl };
}

// The product row, created or updated with what the site said. Upserted by workspaceId, which is unique:
// two tabs finishing step 1 at once settle on one row rather than two half-built ones.
async function saveSiteRead({ workspaceId, userId, site, name }) {
	await GtmProduct.updateOne(
		{ workspaceId },
		{
			$set: {
				url: site.url,
				rawSiteText: site.siteText,
				needsDescription: site.needsDescription,
				...(name && { name: name.slice(0, 120) }),
			},
			$setOnInsert: { workspaceId, createdBy: userId ?? null, onboardingStatus: "new" },
		},
		{ upsert: true }
	);
	return GtmProduct.findOne({ workspaceId }).lean();
}

// Step 2a. Asks the AI what the site left unclear. Stored as its own interview row, so re-asking later
// doesn't lose what the founder said the first time.
export async function startInterview({ workspaceId }) {
	await connectDb();
	const product = await GtmProduct.findOne({ workspaceId }).lean();
	if (!product) return { error: "Read your site first" };

	const asked = await askForJson({
		workspaceId,
		productId: product._id,
		purpose: "interview_questions",
		system: INTERVIEW_SYSTEM,
		prompt: buildInterviewPrompt({
			url: product.url,
			profile: fromProductFields(product),
			siteText: product.rawSiteText ?? "",
		}),
		schema: INTERVIEW_JSON_SCHEMA,
		read: readInterviewQuestions,
	});
	if (asked.error) return { error: asked.error };

	const interview = await GtmOnboardingInterview.create({
		workspaceId,
		productId: product._id,
		questions: asked.value,
		answers: [],
	});
	return { interviewId: String(interview._id), questions: asked.value };
}

// Step 2b. Folds the answers back into the profile. Answers are saved before the AI is called, so a failed
// call doesn't cost the founder their typing.
export async function answerInterview({ workspaceId, interviewId, answers }) {
	await connectDb();
	const product = await GtmProduct.findOne({ workspaceId }).lean();
	if (!product) return { error: "Read your site first" };

	const interview = await GtmOnboardingInterview.findOne({ _id: interviewId, workspaceId });
	if (!interview) return { error: "That interview is gone — start it again" };

	const given = (Array.isArray(answers) ? answers : []).slice(0, interview.questions.length).map((answer) => String(answer ?? "").trim());
	interview.answers = given;
	interview.answeredAt = new Date();
	await interview.save();

	// Every answer blank: there is nothing to refine, so the step is done without spending a call.
	if (given.every((answer) => !answer)) {
		await GtmProduct.updateOne(
			{ _id: product._id },
			{ $set: { onboardingStatus: furthestStatus(product.onboardingStatus, "interviewed") } }
		);
		return { profile: fromProductFields(product), refined: false };
	}

	const refined = await askForJson({
		workspaceId,
		productId: product._id,
		purpose: "profile_refine",
		system: REFINE_SYSTEM,
		prompt: buildRefinePrompt({ profile: fromProductFields(product), questions: interview.questions, answers: given }),
		schema: PROFILE_JSON_SCHEMA,
		read: readProfile,
	});
	// The answers are saved either way; the founder can move on with the profile the site gave us.
	if (refined.error) return { error: refined.error };

	await GtmProduct.updateOne(
		{ _id: product._id },
		{ $set: { ...toProductFields(refined.value), onboardingStatus: furthestStatus(product.onboardingStatus, "interviewed") } }
	);
	return { profile: refined.value, refined: true };
}

// Step 3. The founder's own edits win over anything the AI said, so this validates but does not re-ask.
export async function saveProfile({ workspaceId, fields }) {
	await connectDb();
	const product = await GtmProduct.findOne({ workspaceId }).lean();
	if (!product) return { error: "Read your site first" };

	const checked = readProfile({
		one_line_pitch: fields?.oneLinePitch,
		target_customer: fields?.targetCustomer,
		pains: fields?.pains,
		differentiators: fields?.differentiators,
		keywords: fields?.keywords,
		suggested_communities: [],
	});
	if (checked.error) return { error: checked.error };

	const name = String(fields?.name ?? "").trim();
	await GtmProduct.updateOne(
		{ _id: product._id },
		{
			$set: {
				...toProductFields(checked.value),
				...(name && { name: name.slice(0, 120) }),
				onboardingStatus: furthestStatus(product.onboardingStatus, "profile_reviewed"),
			},
		}
	);
	return { profile: checked.value };
}

// Step 4. Pasted links become watched sources. What was understood and what wasn't both come back: a link
// silently dropped is worse than one shown as rejected.
export async function saveWatchedSources({ workspaceId, urls }) {
	await connectDb();
	const product = await GtmProduct.findOne({ workspaceId }).lean();
	if (!product) return { error: "Read your site first" };

	const { sources, problems } = readWatchedSources(urls);
	if (sources.length === 0) {
		return { error: problems[0]?.error ?? "Paste at least one link", problems };
	}

	const existing = await GtmWatchedSource.countDocuments({ productId: product._id });
	if (existing + sources.length > GTM_LIMITS.maxWatchedSources) {
		return { error: `That's more than ${GTM_LIMITS.maxWatchedSources} places to watch`, problems };
	}

	// Upserted by the same key as the unique index, so pasting a list twice updates rather than throwing.
	await Promise.all(
		sources.map(({ platform, identifier, url }) =>
			GtmWatchedSource.updateOne(
				{ productId: product._id, platform, identifier },
				{ $set: { url, active: true }, $setOnInsert: { workspaceId, productId: product._id, platform, identifier } },
				{ upsert: true }
			)
		)
	);

	await GtmProduct.updateOne(
		{ _id: product._id },
		{ $set: { onboardingStatus: furthestStatus(product.onboardingStatus, "sources_added") } }
	);
	return { sources, problems };
}

export async function listWatchedSources({ workspaceId }) {
	await connectDb();
	return GtmWatchedSource.find({ workspaceId }).sort({ createdAt: 1 }).lean();
}

// Switched off rather than deleted, so the opportunities it already produced aren't orphaned.
export async function setWatchedSourceActive({ workspaceId, sourceId, active }) {
	await connectDb();
	const result = await GtmWatchedSource.updateOne({ _id: sourceId, workspaceId }, { $set: { active: Boolean(active) } });
	if (result.matchedCount === 0) return { error: "That source is gone" };
	return { active: Boolean(active) };
}

// Step 5. Three to five things the founder wrote. Replaces the set rather than adding to it: the form shows
// all of them at once, so what it sends is the whole answer.
export async function saveVoiceSamples({ workspaceId, texts }) {
	await connectDb();
	const product = await GtmProduct.findOne({ workspaceId }).lean();
	if (!product) return { error: "Read your site first" };

	const checked = readVoiceSamples(texts);
	if (checked.problems) return { problems: checked.problems };
	if (checked.error) return { error: checked.error };

	await GtmVoiceSample.deleteMany({ productId: product._id });
	await GtmVoiceSample.insertMany(
		checked.value.map((text) => ({ workspaceId, productId: product._id, text }))
	);

	// The last step: the profile is ready and the radar has everything it needs.
	await GtmProduct.updateOne({ _id: product._id }, { $set: { onboardingStatus: furthestStatus(product.onboardingStatus, "ready") } });
	return { samples: checked.value };
}

export async function listVoiceSamples({ workspaceId }) {
	await connectDb();
	return GtmVoiceSample.find({ workspaceId }).sort({ createdAt: 1 }).lean();
}

// Everything the wizard and the summary screen need, in one read.
export async function getOnboardingState({ workspaceId }) {
	await connectDb();
	const product = await GtmProduct.findOne({ workspaceId }).lean();
	if (!product) return { product: null, status: "new", sources: [], samples: [], interview: null };

	const [sources, samples, interview] = await Promise.all([
		GtmWatchedSource.find({ productId: product._id }).sort({ createdAt: 1 }).lean(),
		GtmVoiceSample.find({ productId: product._id }).sort({ createdAt: 1 }).lean(),
		GtmOnboardingInterview.findOne({ productId: product._id }).sort({ createdAt: -1 }).lean(),
	]);

	return { product, status: product.onboardingStatus, sources, samples, interview };
}
