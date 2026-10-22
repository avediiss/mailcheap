import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import AvatarInitials from "@/components/AvatarInitials";
import BadgeHealth from "@/components/BadgeHealth";
import CardChart from "@/components/CardChart";
import CardStat from "@/components/CardStat";
import ChartDaily from "@/components/ChartDaily";
import ChartRate from "@/components/ChartRate";
import ChartSubscribers from "@/components/ChartSubscribers";
import DialogCreateWorkspace from "@/components/DialogCreateWorkspace";
import HeaderPage from "@/components/HeaderPage";
import ListAudit from "@/components/ListAudit";
import ListSendingProblems from "@/components/ListSendingProblems";
import ListWorkspaceRank from "@/components/ListWorkspaceRank";
import { SkeletonSesAccount } from "@/components/SkeletonOverview";
import StripSesAccount from "@/components/StripSesAccount";
import SwitchRange from "@/components/SwitchRange";
import { listAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { LIMITS } from "@/lib/config";
import { formatNumber, formatRate, formatSigned } from "@/lib/format";
import { getPlatformInsights } from "@/lib/platform-insights";
import { listSendingProblems } from "@/lib/platform-problems";
import { getPlatformTotals, listWorkspaceSummaries } from "@/lib/platform";
import { describeAttention, rankAttention } from "@/lib/platform-rules";
import { findQuietWorkspaces, formatIdle, parseRange, rate, rollingRate } from "@/lib/platform-series";
import { formatCost } from "@/lib/send-cost";

export const metadata = { title: "Platform" };

const HEALTH_TONES = { good: "good", watch: "warn", bad: "bad", unknown: "default" };
const percent = (value, digits = 2) => `${(value * 100).toFixed(digits)}%`;

export default async function PlatformPage({ searchParams }) {
	await requirePlatformAdmin();
	const range = parseRange((await searchParams)?.range);
	const rows = await listWorkspaceSummaries();
	const names = new Map(rows.map(({ id, name }) => [id, name]));
	const [insights, activity, problems] = await Promise.all([getPlatformInsights({ range, names }), listAudit({ limit: 8 }), listSendingProblems()]);

	const totals = getPlatformTotals(rows);
	const attention = rankAttention(rows).slice(0, 6);
	const { send, stack, subscribers } = insights;
	const bounceLine = rollingRate(send.days, "bounced");
	const complaintLine = rollingRate(send.days, "complained");

	const topVolume = Object.entries(send.perWorkspace)
		.filter(([, { sent }]) => sent > 0)
		.sort((a, b) => b[1].sent - a[1].sent)
		.slice(0, 5)
		.map(([id, counts]) => ({ id, name: names.get(id) ?? "Unknown", value: formatNumber(counts.sent), detail: `${formatRate(counts.opened, counts.sent) ?? "No"} opens` }));
	const topGrowth = [...insights.growthBy.entries()]
		.filter(([id, net]) => net > 0 && names.has(id))
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([id, net]) => ({ id, name: names.get(id), value: formatSigned(net), detail: "new subscribers" }));
	const lastSentBy = new Map(rows.filter(({ lastSentAt }) => lastSentAt).map(({ id, lastSentAt }) => [id, lastSentAt]));
	const quiet = findQuietWorkspaces({ workspaces: rows, lastSentBy })
		.slice(0, 5)
		.map(({ id, name, idleDays }) => ({ id, name, value: idleDays === null ? "Never" : `${idleDays}d`, detail: formatIdle(idleDays) }));

	const net = subscribers.total - subscribers.start;
	const openRate = rate(send.totals.opened, send.totals.sent);
	const deliveryNote = send.totals.delivered > 0 ? `${formatRate(send.totals.delivered, send.totals.sent)} delivered` : "Delivery not reported yet";

	return (
		<>
			<HeaderPage title="Platform">
				<SwitchRange range={range} />
				<DialogCreateWorkspace />
			</HeaderPage>

			<div className="flex flex-col gap-8">
				<div className="grid grid-cols-2 gap-3 animate-enter lg:grid-cols-3">
					<CardStat label="Workspaces" value={formatNumber(totals.workspaces)} detail={`${formatNumber(totals.active)} active · ${formatNumber(totals.suspended)} suspended`} />
					<CardStat label="Subscribers" value={formatNumber(totals.contacts)} detail={`${formatSigned(net)} net in ${range} days`} tone={net < 0 ? "warn" : "default"} />
					<CardStat label={`Emails sent, ${range} days`} value={formatNumber(send.totals.sent)} detail={`${formatNumber(totals.emailsThisMonth)} this month`} />
					<CardStat
						label="Bounce rate, 30 days"
						value={totals.sent30 ? percent(totals.bounceRate) : null}
						tone={HEALTH_TONES[totals.health]}
						detail={totals.sent30 ? `${percent(totals.complaintRate, 3)} complaints · ${formatNumber(totals.sent30)} sent` : "No sends yet"}
					/>
					<CardStat label={`Open rate, ${range} days`} value={openRate === null ? null : percent(openRate, 1)} detail={`${formatRate(send.totals.clicked, send.totals.sent) ?? "No"} clicks · ${deliveryNote}`} />
					<CardStat label="Estimated SES cost, this month" value={formatCost(totals.costThisMonth)} detail={`${formatNumber(totals.emailsThisMonth)} emails`} />
				</div>

				<div style={{ "--stagger": 1 }} className="animate-enter">
					<CardChart title="Emails sent" hint="Per day, by workspace. Test emails aren’t counted." value={formatNumber(send.totals.sent)}>
						<ChartDaily stack={stack} />
					</CardChart>
				</div>

				<div style={{ "--stagger": 2 }} className="grid gap-3 animate-enter lg:grid-cols-2">
					<CardChart title="Bounce rate" hint="Of the last 7 days’ emails, across everyone. Sending pauses at the red line." value={totals.sent30 ? percent(totals.bounceRate) : null}>
						<ChartRate days={send.days} values={bounceLine} limit={LIMITS.bounceRate} label="Bounce rate" />
					</CardChart>
					<CardChart title="Complaint rate" hint="The same window. Complaints hurt the shared sending reputation fastest." value={totals.sent30 ? percent(totals.complaintRate, 3) : null}>
						<ChartRate days={send.days} values={complaintLine} limit={LIMITS.complaintRate} digits={3} label="Complaint rate" />
					</CardChart>
				</div>

				<div style={{ "--stagger": 3 }} className="animate-enter">
					<CardChart title="Subscribers" hint={`Everyone who can be emailed. ${formatNumber(subscribers.joined)} joined and ${formatNumber(subscribers.left)} left in ${range} days; bounces without an unsubscribe aren’t counted as leaving.`} value={formatNumber(subscribers.total)}>
						<ChartSubscribers current={subscribers.days} labelEvery={range <= 7 ? 1 : range <= 30 ? 7 : 14} />
					</CardChart>
				</div>

				<section style={{ "--stagger": 4 }} className="flex flex-col gap-3 animate-enter">
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

				{problems.length > 0 && (
					<section style={{ "--stagger": 5 }} className="flex flex-col gap-3 animate-enter">
						<h2 className="text-sm font-medium text-muted-foreground">Sending problems</h2>
						<ListSendingProblems problems={problems} workspaceNames={names} />
					</section>
				)}

				<div style={{ "--stagger": 6 }} className="grid gap-6 animate-enter lg:grid-cols-3">
					<ListWorkspaceRank title="Top by volume" hint={`Emails sent in ${range} days`} rows={topVolume} empty="No emails sent in this period." />
					<ListWorkspaceRank title="Fastest growing" hint={`Net new subscribers in ${range} days`} rows={topGrowth} empty="No workspace grew in this period." />
					<ListWorkspaceRank title="Gone quiet" hint="No email sent for 30 days, or none since the first week" rows={quiet} empty="Every active workspace has sent recently." />
				</div>

				<section style={{ "--stagger": 7 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Sending service</h2>
					<Suspense fallback={<SkeletonSesAccount />}>
						<StripSesAccount />
					</Suspense>
				</section>

				<section style={{ "--stagger": 8 }} className="flex flex-col gap-3 animate-enter">
					<div className="flex items-baseline justify-between gap-3">
						<h2 className="text-sm font-medium text-muted-foreground">Recent activity</h2>
						<Link href="/platform/activity" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
							View all
						</Link>
					</div>
					<ListAudit entries={activity} workspaceNames={names} />
				</section>
			</div>
		</>
	);
}
