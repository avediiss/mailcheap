"use client";

import { useTransition } from "react";
import { Check, Trophy } from "lucide-react";
import { toast } from "sonner";
import { setAbWinner } from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import { formatNumber, formatRate } from "@/lib/format";

const VERDICT_TEXT = {
	"small-sample": "Too early to call: each subject needs about 30 delivered emails first.",
	"too-close": "Too close to call: the opens are within 2 points of each other.",
};

// Both subjects side by side. Picking a winner makes "Send to more" use it for everyone left.
export default function CardAbTest({ campaign, variants, verdict, canPick }) {
	const [isPending, startTransition] = useTransition();
	const subjects = { A: campaign.subject, B: campaign.subjectB };

	function pick(variant) {
		startTransition(async () => {
			const result = await setAbWinner(campaign._id, variant);
			if (result?.error) toast.error(result.error);
			else toast.success(`Subject ${variant} will be used for the rest`);
		});
	}

	return (
		<div className="overflow-hidden rounded-xl bg-card shadow-border animate-enter" style={{ "--stagger": 2 }}>
			<div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
				<span className="text-sm font-medium">Subject test</span>
				{campaign.abWinner ? (
					<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<Trophy className="size-3.5" />
						Subject {campaign.abWinner} chosen for the rest
					</span>
				) : (
					<span className="text-right text-xs text-muted-foreground">
						{verdict?.leader ? `Subject ${verdict.leader} is ahead` : VERDICT_TEXT[verdict?.reason]}
					</span>
				)}
			</div>
			<div className="grid sm:grid-cols-2">
				{variants.map((variant) => (
					<div
						key={variant.variant}
						className="flex flex-col gap-3 border-b border-border/60 p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
					>
						<div className="flex items-start gap-2">
							<span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{variant.variant}</span>
							<span className="text-sm break-words">{subjects[variant.variant] || "—"}</span>
						</div>
						<div className="flex gap-6 text-sm tabular-nums">
							<span>
								<span className="block text-xs text-muted-foreground">Sent</span>
								{formatNumber(variant.sent)}
							</span>
							<span>
								<span className="block text-xs text-muted-foreground">Opened</span>
								{formatRate(variant.opened, variant.delivered || variant.sent) ?? "—"}
							</span>
							<span>
								<span className="block text-xs text-muted-foreground">Clicked</span>
								{formatRate(variant.clicked, variant.delivered || variant.sent) ?? "—"}
							</span>
						</div>
						{canPick && !campaign.abWinner && (
							<Button
								variant={verdict?.leader === variant.variant ? "default" : "outline"}
								size="sm"
								className="self-start"
								disabled={isPending}
								onClick={() => pick(variant.variant)}
							>
								<Check data-icon="inline-start" />
								Use {variant.variant} for the rest
							</Button>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
