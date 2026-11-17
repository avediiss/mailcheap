"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import CardGtmSummary from "@/components/gtm/CardGtmSummary";
import FormGtmInterview from "@/components/gtm/FormGtmInterview";
import FormGtmProfile from "@/components/gtm/FormGtmProfile";
import FormGtmSources from "@/components/gtm/FormGtmSources";
import FormGtmUrl from "@/components/gtm/FormGtmUrl";
import FormGtmVoice from "@/components/gtm/FormGtmVoice";

// The six steps, in order. Each one saves on the server before it returns, so the step a founder comes back
// to is read from the product's onboardingStatus rather than kept in the browser.
const STEPS = [
	{ key: "site", label: "Your product" },
	{ key: "interview", label: "Questions" },
	{ key: "profile", label: "Profile" },
	{ key: "sources", label: "Where to watch" },
	{ key: "voice", label: "Your voice" },
	{ key: "done", label: "Ready" },
];

// Where the wizard opens: the step after the furthest one finished.
const STEP_FOR_STATUS = {
	new: 0,
	site_read: 1,
	interviewed: 2,
	profile_reviewed: 3,
	sources_added: 4,
	ready: 5,
};

export default function StepsGtmOnboarding({ state }) {
	const [stepIndex, setStepIndex] = useState(STEP_FOR_STATUS[state.status] ?? 0);
	// How far they have actually got, which is what makes a step clickable. It only grows.
	const furthestIndex = STEP_FOR_STATUS[state.status] ?? 0;

	const goNext = () => setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
	const step = STEPS[stepIndex].key;

	return (
		<div className="flex flex-col gap-6">
			<ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 animate-enter">
				{STEPS.map(({ key, label }, index) => {
					const isDone = index < furthestIndex;
					const isCurrent = index === stepIndex;
					// A step not yet reached isn't a link: there is nothing saved behind it to go back to.
					const isReachable = index <= furthestIndex;

					return (
						<li key={key} className="flex items-center gap-1.5">
							<button
								type="button"
								disabled={!isReachable}
								onClick={() => setStepIndex(index)}
								aria-current={isCurrent ? "step" : undefined}
								className={cn(
									"flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-150",
									isCurrent && "bg-foreground text-background",
									!isCurrent && isReachable && "text-muted-foreground hover:bg-muted hover:text-foreground",
									!isReachable && "text-muted-foreground/50"
								)}
							>
								{isDone ? (
									<Check className="size-3.5" aria-hidden="true" />
								) : (
									<span className="tabular-nums">{index + 1}</span>
								)}
								{label}
							</button>
							{index < STEPS.length - 1 && <span aria-hidden="true" className="h-px w-3 bg-border" />}
						</li>
					);
				})}
			</ol>

			{step === "site" && <FormGtmUrl product={state.product} onDone={goNext} />}
			{step === "interview" && <FormGtmInterview interview={state.interview} onDone={goNext} />}
			{step === "profile" && <FormGtmProfile product={state.product} onDone={goNext} />}
			{step === "sources" && <FormGtmSources sources={state.sources} suggestions={state.product?.keywords ?? []} onDone={goNext} />}
			{step === "voice" && <FormGtmVoice samples={state.samples} onDone={goNext} />}
			{step === "done" && <CardGtmSummary state={state} onEdit={setStepIndex} />}
		</div>
	);
}
