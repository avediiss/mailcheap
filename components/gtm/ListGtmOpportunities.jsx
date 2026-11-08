"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { skipOpportunity } from "@/app/(app)/gtm/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// The queue: posts the radar thinks are worth a reply, best first. The founder's whole daily use of this
// module is this screen, so the reason sits beside the score — a number alone asks them to trust it, and
// the reason is what lets them disagree in one glance.

const PLATFORM_LABELS = { x: "X", reddit: "Reddit", hn: "Hacker News", other: "Elsewhere" };

// Green is a claim, and an unscored post makes no claim at all.
function toneFor(score) {
	if (score === null || score === undefined) return "bg-muted text-muted-foreground";
	if (score >= 80) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
	if (score >= 60) return "bg-amber-500/15 text-amber-700 dark:text-amber-500";
	return "bg-muted text-muted-foreground";
}

function when(iso) {
	const posted = new Date(iso);
	const hours = Math.round((Date.now() - posted.getTime()) / 3_600_000);
	if (hours < 1) return "just now";
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return days === 1 ? "yesterday" : `${days} days ago`;
}

function Opportunity({ opportunity, onSkip, isSkipping }) {
	const { id, url, author, text, postedAt, score, reason, keywords, contextTitle, platform } = opportunity;

	return (
		<article className="flex flex-col gap-2.5 rounded-xl px-4 py-3.5 shadow-border animate-enter">
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					<span className={`rounded-md px-1.5 py-0.5 font-medium ${toneFor(score)}`}>
						{score === null || score === undefined ? "unscored" : score}
					</span>
					<span className="font-medium text-foreground">{author || "someone"}</span>
					<span>on {PLATFORM_LABELS[platform] ?? platform}</span>
					<span>·</span>
					<span>{when(postedAt)}</span>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button asChild variant="ghost" size="sm">
						<a href={url} target="_blank" rel="noopener noreferrer">
							<ExternalLink className="size-3.5" aria-hidden="true" />
							Open
						</a>
					</Button>
					<Button variant="ghost" size="sm" onClick={() => onSkip(id)} disabled={isSkipping}>
						<X className="size-3.5" aria-hidden="true" />
						Skip
					</Button>
				</div>
			</div>

			{contextTitle && <p className="text-xs text-muted-foreground">Under: {contextTitle}</p>}
			{/* Four lines is enough to judge it; the post itself is one click away. */}
			<p className="line-clamp-4 text-sm whitespace-pre-line">{text}</p>
			{reason && <p className="text-sm text-muted-foreground">{reason}</p>}

			{keywords?.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{keywords.map((keyword) => (
						<Badge key={keyword} variant="secondary" className="font-normal">
							{keyword}
						</Badge>
					))}
				</div>
			)}
		</article>
	);
}

export default function ListGtmOpportunities({ opportunities, scan }) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [skipping, setSkipping] = useState(null);

	function onSkip(id) {
		setSkipping(id);
		startTransition(async () => {
			const result = await skipOpportunity({ opportunityId: id });
			setSkipping(null);
			if (result?.error) {
				toast.error(result.error);
				return;
			}
			toast.success("Skipped. The radar won't offer it again.");
			router.refresh();
		});
	}

	if (opportunities.length === 0) {
		return (
			<div className="flex flex-col gap-2 rounded-xl bg-muted px-4 py-3.5 animate-enter">
				<p className="text-sm font-medium">Nothing worth replying to yet</p>
				{/* An empty queue is the usual answer, so it has to say which kind of empty: nothing
				    searched, nothing found, or nothing good enough. Otherwise it reads as broken. */}
				<p className="text-sm text-muted-foreground">
					{scan.lastScanAt
						? `Last looked ${when(scan.lastScanAt)} across ${scan.sources} ${scan.sources === 1 ? "source" : "sources"}. Most posts mentioning your keywords turn out not to be people with your problem, so an empty list is normal — but if it stays empty for days, the keywords are usually why.`
						: "The radar hasn't run yet. It scans every three hours once the schedule is live."}
				</p>
				{scan.lastError && <p className="text-sm text-muted-foreground">Last problem: {scan.lastError}</p>}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2.5" aria-busy={isPending}>
			{opportunities.map((opportunity) => (
				<Opportunity
					key={opportunity.id}
					opportunity={opportunity}
					onSkip={onSkip}
					isSkipping={skipping === opportunity.id}
				/>
			))}
		</div>
	);
}
