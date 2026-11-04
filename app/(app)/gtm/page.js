import { notFound } from "next/navigation";
import { Radar } from "lucide-react";
import HeaderPage from "@/components/HeaderPage";
import StepsGtmOnboarding from "@/components/gtm/StepsGtmOnboarding";
import { isGtmAiConfigured, isGtmEnabled } from "@/lib/gtm/config";
import { getOnboardingState } from "@/lib/gtm/onboarding";
import { serialize } from "@/lib/serialize";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "GTM agent" };

export default async function GtmPage() {
	const { workspaceId } = await requireWorkspace();
	// Switched off, the module does not exist: not a disabled page, not a teaser. The server actions check
	// the same flag themselves, since they are reachable without this page.
	if (!isGtmEnabled()) notFound();

	const state = await getOnboardingState({ workspaceId });

	return (
		<>
			<HeaderPage
				title="GTM agent"
				icon={
					<span className="mr-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
						<Radar className="size-4" aria-hidden="true" />
					</span>
				}
			/>
			{!isGtmAiConfigured() && (
				<div className="mb-6 rounded-xl bg-muted px-4 py-3 text-sm animate-enter">
					<p className="font-medium">The AI isn&apos;t configured</p>
					<p className="mt-0.5 text-muted-foreground">
						Set <code className="rounded bg-foreground/10 px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code> to read a
						site and draft a profile. You can still fill the profile in by hand.
					</p>
				</div>
			)}
			{/* Mongoose gives back ObjectIds and Dates, which can't cross into a client component. */}
			<StepsGtmOnboarding state={serialize(state)} />
		</>
	);
}
