import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import AvatarInitials from "@/components/AvatarInitials";
import BadgeHealth from "@/components/BadgeHealth";
import CardStat from "@/components/CardStat";
import DialogCreateWorkspace from "@/components/DialogCreateWorkspace";
import HeaderPage from "@/components/HeaderPage";
import ListAudit from "@/components/ListAudit";
import { SkeletonSesAccount } from "@/components/SkeletonOverview";
import StripSesAccount from "@/components/StripSesAccount";
import { listAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { getPlatformTotals, listWorkspaceSummaries } from "@/lib/platform";
import { describeAttention, rankAttention } from "@/lib/platform-rules";
import { estimateCost, formatCost, getPricePer1000 } from "@/lib/send-cost";

export const metadata = { title: "Platform" };

const HEALTH_TONES = { good: "good", watch: "warn", bad: "bad", unknown: "default" };

function formatPercent(rate, digits = 2) {
	return `${(rate * 100).toFixed(digits)}%`;
}

export default async function PlatformPage() {
	await requirePlatformAdmin();
	const [rows, activity] = await Promise.all([listWorkspaceSummaries(), listAudit({ limit: 8 })]);
	const totals = getPlatformTotals(rows);
	const attention = rankAttention(rows).slice(0, 6);
	const names = new Map(rows.map(({ id, name }) => [id, name]));
	const price = getPricePer1000();

	return (
		<>
			<HeaderPage title="Platform">
				<DialogCreateWorkspace />
			</HeaderPage>

			<div className="flex flex-col gap-8">
				<div className="grid grid-cols-2 gap-3 animate-enter lg:grid-cols-4">
					<CardStat label="Workspaces" value={formatNumber(totals.workspaces)} detail={`${formatNumber(totals.active)} active · ${formatNumber(totals.suspended)} suspended`} />
					<CardStat label="Contacts" value={formatNumber(totals.contacts)} detail="People who can be emailed" />
					<CardStat label="Emails this month" value={formatNumber(totals.emailsThisMonth)} detail={`About ${formatCost(estimateCost(totals.emailsThisMonth, price))} on Amazon SES`} />
					<CardStat
						label="Bounce rate, 30 days"
						value={totals.sent30 ? formatPercent(totals.bounceRate) : null}
						tone={HEALTH_TONES[totals.health]}
						detail={totals.sent30 ? `${formatPercent(totals.complaintRate, 3)} complaints · ${formatNumber(totals.sent30)} sent` : "No sends yet"}
					/>
				</div>

				<section style={{ "--stagger": 1 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Needs attention</h2>
					{attention.length === 0 ? (
						<p className="flex items-center gap-2 rounded-xl px-4 py-5 text-sm text-muted-foreground shadow-border">
							<ShieldCheck className="size-4 text-emerald-600" />
							Everything looks fine. No workspace is at risk, suspended or at a limit.
						</p>
					) : (
						<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
							{attention.map((row) => (
								<li key={row.id}>
									<Link href={`/platform/workspaces/${row.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/50">
										<AvatarInitials name={row.name} size={32} shape="square" />
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate text-sm font-medium">{row.name}</span>
											<span className="truncate text-xs text-muted-foreground">{describeAttention(row).join(" · ")}</span>
										</span>
										<BadgeHealth health={row.health} className="hidden sm:inline-flex" />
										<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
									</Link>
								</li>
							))}
						</ul>
					)}
				</section>

				<section style={{ "--stagger": 2 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Sending service</h2>
					<Suspense fallback={<SkeletonSesAccount />}>
						<StripSesAccount />
					</Suspense>
				</section>

				<section style={{ "--stagger": 3 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Recent activity</h2>
					<ListAudit entries={activity} workspaceNames={names} />
				</section>
			</div>
		</>
	);
}
