"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { isGtmAiConfigured, isGtmEnabled } from "@/lib/gtm/config";
import {
	answerInterview,
	readSiteAndExtractProfile,
	saveProfile,
	saveVoiceSamples,
	saveWatchedSources,
	setWatchedSourceActive,
	startInterview,
} from "@/lib/gtm/onboarding";
import { requireWorkspace } from "@/lib/workspace";

// The onboarding wizard's server actions. Each one is the same three steps: the module must be on, the
// person must have a workspace, and then the service in lib/gtm/onboarding.js does the work. Server actions
// are reachable by POST whether or not a page links to them, so the flag and the workspace are checked in
// every one rather than once in the page.

// The one place the two gates live. Returns the workspace, or the reason there isn't one to act on.
async function requireGtmWorkspace() {
	// Off: the whole module is "not found", the same answer the page gives.
	if (!isGtmEnabled()) return { error: "The GTM agent isn't switched on" };
	const { workspaceId, session } = await requireWorkspace();
	return { workspaceId, userId: session.userId };
}

export async function readSite({ url, pastedDescription }) {
	const gate = await requireGtmWorkspace();
	if (gate.error) return { error: gate.error };
	// The site can be read without a key; only the profile that follows needs one.
	if (!isGtmAiConfigured()) return { error: "The AI isn't configured yet (ANTHROPIC_API_KEY)" };

	const result = await readSiteAndExtractProfile({
		workspaceId: gate.workspaceId,
		userId: gate.userId,
		url: String(url ?? ""),
		pastedDescription: String(pastedDescription ?? ""),
	});
	revalidatePath("/gtm");
	return result;
}

export async function askInterviewQuestions() {
	const gate = await requireGtmWorkspace();
	if (gate.error) return { error: gate.error };
	if (!isGtmAiConfigured()) return { error: "The AI isn't configured yet (ANTHROPIC_API_KEY)" };

	const result = await startInterview({ workspaceId: gate.workspaceId });
	revalidatePath("/gtm");
	return result;
}

export async function submitInterviewAnswers({ interviewId, answers }) {
	const gate = await requireGtmWorkspace();
	if (gate.error) return { error: gate.error };
	if (!isValidObjectId(String(interviewId ?? ""))) return { error: "That interview is gone — start it again" };
	if (!isGtmAiConfigured()) return { error: "The AI isn't configured yet (ANTHROPIC_API_KEY)" };

	const result = await answerInterview({
		workspaceId: gate.workspaceId,
		interviewId: String(interviewId),
		answers: Array.isArray(answers) ? answers.map((answer) => String(answer ?? "")) : [],
	});
	revalidatePath("/gtm");
	return result;
}

// The founder's own edits. No AI call, so no key is needed: they can finish onboarding by hand if the
// extraction failed.
export async function saveProductProfile(fields) {
	const gate = await requireGtmWorkspace();
	if (gate.error) return { error: gate.error };

	const result = await saveProfile({
		workspaceId: gate.workspaceId,
		fields: {
			name: String(fields?.name ?? ""),
			oneLinePitch: String(fields?.oneLinePitch ?? ""),
			targetCustomer: String(fields?.targetCustomer ?? ""),
			differentiators: String(fields?.differentiators ?? ""),
			pains: Array.isArray(fields?.pains) ? fields.pains.map((pain) => String(pain ?? "")) : [],
			keywords: Array.isArray(fields?.keywords) ? fields.keywords.map((keyword) => String(keyword ?? "")) : [],
		},
	});
	revalidatePath("/gtm");
	return result;
}

export async function addWatchedSources({ urls }) {
	const gate = await requireGtmWorkspace();
	if (gate.error) return { error: gate.error };

	const result = await saveWatchedSources({
		workspaceId: gate.workspaceId,
		urls: Array.isArray(urls) ? urls.map((url) => String(url ?? "")) : [],
	});
	revalidatePath("/gtm");
	return result;
}

export async function toggleWatchedSource({ sourceId, active }) {
	const gate = await requireGtmWorkspace();
	if (gate.error) return { error: gate.error };
	// An id from the browser is only trusted once it is found with this workspace's id, which the service does.
	if (!isValidObjectId(String(sourceId ?? ""))) return { error: "That source is gone" };

	const result = await setWatchedSourceActive({
		workspaceId: gate.workspaceId,
		sourceId: String(sourceId),
		active: Boolean(active),
	});
	revalidatePath("/gtm");
	return result;
}

export async function saveVoice({ texts }) {
	const gate = await requireGtmWorkspace();
	if (gate.error) return { error: gate.error };

	const result = await saveVoiceSamples({
		workspaceId: gate.workspaceId,
		texts: Array.isArray(texts) ? texts.map((text) => String(text ?? "")) : [],
	});
	revalidatePath("/gtm");
	return result;
}
