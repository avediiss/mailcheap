import { Types, isValidObjectId } from "mongoose";
import { notFound } from "next/navigation";
import AvatarInitials from "@/components/AvatarInitials";
import BadgeHealth from "@/components/BadgeHealth";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonWorkspaceStatus from "@/components/ButtonWorkspaceStatus";
import ChartDaily from "@/components/ChartDaily";
import FormAssignDomain from "@/components/FormAssignDomain";
import FormSending from "@/components/FormSending";
import FormWorkspaceSettings from "@/components/FormWorkspaceSettings";
import HeaderPage from "@/components/HeaderPage";
import ListAudit from "@/components/ListAudit";
import MeterUsage from "@/components/MeterUsage";
import { listAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { roleLabel } from "@/lib/roles";
import { listInvitations, listMembers } from "@/lib/members";
import { getWorkspaceDetail } from "@/lib/platform";
import { getPlatformInsights } from "@/lib/platform-insights";
import { loadSendState } from "@/lib/send-plan-server";
import { getAccountBlockReason } from "@/lib/workspace-health";
import { getHealthTotals } from "@/lib/workspace-health-server";
import Workspace from "@/models/Workspace";
import { formatCost } from "@/lib/send-cost";

export const metadata = { title: "Workspace" };

function formatPercent(part, total, digits = 2) {
	return total ? `${((part / total) * 100).toFixed(digits)}%` : "—";
}

export default async function WorkspaceDetailPage({ params }) {
	await requirePlatformAdmin();
	const { id } = await params;
	if (!isValidObjectId(id)) notFound();
	const detail = await getWorkspaceDetail(id);
	if (!detail) notFound();
	const { summary, domains, newsletters } = detail;
	const [members, invitations, activity, insights] = await Promise.all([
		listMembers(id),
		listInvitations(id),
		listAudit({ workspaceId: id, limit: 12 }),
		getPlatformInsights({ range: 30, names: new Map([[id, summary.name]]), workspaceId: id }),
	]);
	const projection = summary.emailsProjection;
	const [sending, health, own] = await Promise.all([
		loadSendState(id),
		getHealthTotals({ workspaceId: new Types.ObjectId(id) }),
		Workspace.findById(id).select({ sendingTrust: 1, blockReason: 1 }).lean(),
	]);

	return (
		<>
			<HeaderPage
				title={summary.name}
				backHref="/platform/workspaces"
				icon={<AvatarInitials name={summary.name} size={32} shape="square" />}
				meta={summary.status === "suspended" ? <BadgeStatus status="paused" label="Suspended" /> : <BadgeStatus status="active" label="Active" />}
			>
				<ButtonWorkspaceStatus id={summary.id} name={summary.name} status={summary.status} />
			</HeaderPage>

			<div className="flex max-w-3xl flex-col gap-8">
				<Section title="Usage" stagger={0}>
					<div className="flex flex-col gap-4 p-4 sm:p-5">
						<MeterUsage label="Contacts" meter={summary.contactsMeter} />
						<MeterUsage label="Emails this month" meter={summary.emailsMeter} />
						{projection.state === "over" && (
							<p className="-mt-2 text-xs text-amber-600 dark:text-amber-400">
								On pace for about {formatNumber(projection.projected)} emails by the end of the month, over its limit.
							</p>
						)}
						{projection.state === "ok" && projection.isReliable && summary.limits.emailsPerMonth !== null && (
							<p className="-mt-2 text-xs text-muted-foreground">On pace for about {formatNumber(projection.projected)} emails this month.</p>
						)}
						<MeterUsage label="Newsletters" meter={summary.newslettersMeter} />
					</div>
				</Section>

				<Section title="Emails sent, last 30 days" stagger={1}>
					<div className="p-4 sm:p-5">
						<ChartDaily stack={insights.stack} className="h-40 sm:h-48" />
					</div>
					<dl className="grid grid-cols-2 gap-px border-t border-border/60 bg-border/60 sm:grid-cols-4">
						{[
							["Sent", formatNumber(insights.send.totals.sent)],
							["Opens", formatPercent(insights.send.totals.opened, insights.send.totals.sent, 1)],
							["Clicks", formatPercent(insights.send.totals.clicked, insights.send.totals.sent, 1)],
							["SES cost this month", formatCost(summary.costThisMonth)],
						].map(([label, value]) => (
							<div key={label} className="flex flex-col gap-1 bg-card px-4 py-3">
								<dt className="text-xs text-muted-foreground">{label}</dt>
								<dd className="text-lg font-semibold tabular-nums">{value}</dd>
							</div>
						))}
					</dl>
					<p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">Open and click rates are estimates: some mail apps open emails on their own or hide opens.</p>
				</Section>

				<Section title="Deliverability, last 30 days" stagger={1}>
					<dl className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
						{[
							["Sent", formatNumber(summary.sent30)],
							["Bounced", formatPercent(summary.bounced30, summary.sent30)],
							["Complaints", formatPercent(summary.complained30, summary.sent30, 3)],
						].map(([label, value]) => (
							<div key={label} className="flex flex-col gap-1 bg-card px-4 py-3">
								<dt className="text-xs text-muted-foreground">{label}</dt>
								<dd className="text-lg font-semibold tabular-nums">{value}</dd>
							</div>
						))}
						<div className="flex flex-col items-start justify-center gap-1 bg-card px-4 py-3">
							<dt className="text-xs text-muted-foreground">Health</dt>
							<dd>
								<BadgeHealth health={summary.health} />
							</dd>
						</div>
					</dl>
				</Section>

				<Section title="Sending speed" stagger={2}>
					{summary.blockReason && (
						<p className="border-b border-border/60 bg-red-500/10 px-4 py-3 text-sm text-pretty text-red-700 sm:px-5 dark:text-red-300">
							Blocked automatically: {summary.blockReason}. Resume it from the button above once you have looked into it.
						</p>
					)}
					<dl className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
						{[
							["Warm-up", sending.isTrusted ? "Trusted" : sending.cap === own?.sendingTrust?.dailyCap ? "Set by you" : `Day ${Math.min(sending.warmupDay, 31)} of 30`],
							["Daily allowance", Number.isFinite(sending.cap) ? formatNumber(sending.cap) : "No limit"],
							["Sent today", formatNumber(sending.sentToday)],
							["Last 7 days", `${formatNumber(health.bounced)} bounced · ${formatNumber(health.complained)} spam`],
						].map(([label, value]) => (
							<div key={label} className="flex flex-col gap-1 bg-card px-4 py-3">
								<dt className="text-xs text-muted-foreground">{label}</dt>
								<dd className="text-sm font-semibold tabular-nums">{value}</dd>
							</div>
						))}
					</dl>
					{getAccountBlockReason(health) === null && health.sent > 0 && (
						<p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">{formatNumber(health.sent)} emails in the last 7 days. The account is blocked at 5% bounces or 0.3% spam complaints.</p>
					)}
					<FormSending id={summary.id} isTrusted={Boolean(own?.sendingTrust?.isTrusted)} dailyCap={own?.sendingTrust?.dailyCap} />
				</Section>

				<Section title="Settings and limits" stagger={2}>
					<FormWorkspaceSettings id={summary.id} name={summary.name} limits={summary.limits} />
				</Section>

				<Section title={`People (${members.length})`} stagger={3}>
					<ul className="divide-y divide-border/60">
						{members.map((member) => (
							<li key={member.userId} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-5">
								<AvatarInitials name={member.name || member.email} size={28} />
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate font-medium">{member.name || member.email}</span>
									{member.name && <span className="truncate text-xs text-muted-foreground">{member.email}</span>}
								</span>
								<span className="text-muted-foreground">{roleLabel(member.role)}</span>
								<span className="hidden w-40 text-right text-xs text-muted-foreground sm:block">{member.lastLoginAt ? formatRelative(member.lastLoginAt) : "Never logged in"}</span>
							</li>
						))}
						{invitations.map((invitation) => (
							<li key={invitation.id} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-5">
								<span className="grid size-7 shrink-0 place-items-center rounded-full border border-dashed text-xs text-muted-foreground">?</span>
								<span className="min-w-0 flex-1 truncate">{invitation.email}</span>
								<span className="text-muted-foreground">{roleLabel(invitation.role)}</span>
								<span className="w-40 text-right text-xs text-muted-foreground">{invitation.isExpired ? "Invitation expired" : `Invited · until ${formatDate(invitation.expiresAt)}`}</span>
							</li>
						))}
						{members.length === 0 && invitations.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Nobody yet</li>}
					</ul>
				</Section>

				<Section title="Newsletters and domains" stagger={4}>
					<p className="border-b border-border/60 bg-card px-4 py-3 text-xs text-pretty text-muted-foreground sm:px-5">
						Configuration only. This account can control a workspace, but can’t see its contacts, campaigns or emails.
					</p>
					<div className="grid gap-px bg-border/60 sm:grid-cols-2">
						<div className="flex flex-col gap-2 bg-card p-4 sm:p-5">
							<span className="text-xs text-muted-foreground">Newsletters</span>
							{newsletters.length === 0 ? <span className="text-sm text-muted-foreground">None yet</span> : newsletters.map((newsletter) => (
								<span key={newsletter.id} className="flex flex-col text-sm">
									<span className="font-medium">{newsletter.name}</span>
									<span className="text-xs text-muted-foreground">{newsletter.fromEmail}</span>
								</span>
							))}
						</div>
						<div className="flex flex-col gap-2 bg-card p-4 sm:p-5">
							<span className="text-xs text-muted-foreground">Sending domains</span>
							{domains.length === 0 ? <span className="text-sm text-muted-foreground">None yet</span> : domains.map((domain) => (
								<span key={domain.id} className="font-mono text-sm">{domain.domain}</span>
							))}
							<FormAssignDomain id={summary.id} />
						</div>
					</div>
				</Section>

				<section style={{ "--stagger": 5 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Activity</h2>
					<ListAudit entries={activity} />
				</section>
			</div>
		</>
	);
}

function Section({ title, stagger, children }) {
	return (
		<section style={{ "--stagger": stagger }} className="flex flex-col gap-3 animate-enter">
			<h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
			<div className="overflow-hidden rounded-xl bg-card shadow-border">{children}</div>
		</section>
	);
}
