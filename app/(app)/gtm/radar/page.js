import Link from "next/link";
import { notFound } from "next/navigation";
import { Radar } from "lucide-react";
import HeaderPage from "@/components/HeaderPage";
import ListGtmOpportunities from "@/components/gtm/ListGtmOpportunities";
import { Button } from "@/components/ui/button";
import { isGtmEnabled } from "@/lib/gtm/config";
import { getProduct, listWatchedSources } from "@/lib/gtm/onboarding";
import { listOpportunities } from "@/lib/gtm/radar-store";
import { serialize } from "@/lib/serialize";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Radar" };

export default async function GtmRadarPage() {
	const { workspaceId } = await requireWorkspace();
	// The same answer the rest of the module gives when it is switched off: it does not exist.
	if (!isGtmEnabled()) notFound();

	const product = await getProduct(workspaceId);
	// Nothing to show and nothing to explain: onboarding is the only thing worth offering.
	if (!product) {
		return (
			<>
				<HeaderPage title="Radar" />
				<div className="flex flex-col items-start gap-3 rounded-xl bg-muted px-4 py-3.5">
					<p className="text-sm text-muted-foreground">Tell the agent what you are building and it will start looking.</p>
					<Button asChild size="sm">
						<Link href="/gtm">Set up the agent</Link>
					</Button>
				</div>
			</>
		);
	}

	const [opportunities, sources] = await Promise.all([
		listOpportunities({ productId: product._id }),
		listWatchedSources({ workspaceId }),
	]);

	const active = sources.filter(({ active: isActive }) => isActive);
	// The most recent watermark across the sources is what "last looked" means to a founder, and the most
	// recent error is the reason an empty list might not simply be a quiet week.
	const scan = {
		sources: active.length,
		lastScanAt:
			active
				.map(({ lastScanAt }) => lastScanAt)
				.filter(Boolean)
				.sort()
				.at(-1) ?? null,
		lastError:
			active
				.map(({ lastError }) => lastError)
				.filter(Boolean)
				.at(0) ?? null,
	};

	return (
		<>
			<HeaderPage
				title="Radar"
				icon={
					<span className="mr-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
						<Radar className="size-4" aria-hidden="true" />
					</span>
				}
			>
				<Button asChild variant="outline" size="sm">
					<Link href="/gtm">Edit the profile</Link>
				</Button>
			</HeaderPage>
			{/* Mongoose gives back ObjectIds and Dates, which can't cross into a client component. */}
			<ListGtmOpportunities
				opportunities={serialize(opportunities).map((opportunity) => ({ ...opportunity, id: opportunity._id }))}
				scan={serialize(scan)}
			/>
		</>
	);
}
