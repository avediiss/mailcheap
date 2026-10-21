import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { ChevronRight, Newspaper, Settings2, TriangleAlert } from "lucide-react";
import ButtonNewCampaign from "@/components/ButtonNewCampaign";
import CardStat from "@/components/CardStat";
import CardUsage from "@/components/CardUsage";
import ChartSends from "@/components/ChartSends";
import ChartSubscribers from "@/components/ChartSubscribers";
import CookieTimezone from "@/components/CookieTimezone";
import ListDomainStatus from "@/components/ListDomainStatus";
import ListStats from "@/components/ListStats";
import SkeletonCampaigns from "@/components/SkeletonCampaigns";
import StripSesAccount from "@/components/StripSesAccount";
import {
	SkeletonDomainList,
	SkeletonSends,
	SkeletonSesAccount,
	SkeletonStats,
	SkeletonSubscribers,
} from "@/components/SkeletonOverview";
import StateEmpty from "@/components/StateEmpty";
import SwatchChart from "@/components/SwatchChart";
import TableCampaigns from "@/components/TableCampaigns";
import TabsNewsletter from "@/components/TabsNewsletter";
import { Button } from "@/components/ui/button";
import { recentCampaignsPipeline } from "@/lib/campaign-queries";
import { requireWorkspace, listWorkspaceDomains } from "@/lib/workspace";
import { filterDomainsForWorkspace } from "@/lib/workspace-rules";
import { listNewslettersWithActiveCounts } from "@/lib/contacts";
import { connectDb } from "@/lib/db";
import { formatNumber, formatSigned } from "@/lib/format";
import { NEWSLETTER_SUMMARY_FIELDS, toNewsletterMap, toNewsletterOptions } from "@/lib/newsletters";
import { getEmailStats, getHourlySends, getSubscriberHistory } from "@/lib/overview-data";
import { PERIOD_DAYS } from "@/lib/overview-series";
import { getWorkspaceUsage } from "@/lib/quota";
import { estimateCost, formatCost, getPricePer1000, startOfMonth } from "@/lib/send-cost";
import { listSesDomains } from "@/lib/ses";
import { TIME_ZONE_COOKIE, resolveTimeZone, timeZoneLabel } from "@/lib/time-zone";
import { cn } from "@/lib/utils";
import Campaign from "@/models/Campaign";
import Message from "@/models/Message";

// Everything above Domains is about one newsletter, the largest unless ?newsletter= picks one. The page
// waits for one query (the tabs); every section then loads on its own behind a skeleton of its size.
export default async function OverviewPage({ searchParams }) {
	const [{ newsletter: newsletterParam }, cookieStore, { workspaceId, session }] = await Promise.all([
		searchParams,
		cookies(),
		requireWorkspace(),
		connectDb(),
	]);
	const timeZone = resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value);
	const newsletters = await listNewslettersWithActiveCounts(workspaceId, NEWSLETTER_SUMMARY_FIELDS);
	const bySize = newsletters.toSorted((a, b) => b.activeCount - a.activeCount);
	const selected = bySize.find(({ _id }) => _id.toString() === newsletterParam) ?? bySize[0];
	const selectedId = selected?._id.toString();

	return (
		<>
			<h1 className="sr-only">Overview</h1>
			<Suspense fallback={null}>
				<CookieTimezone />
			</Suspense>

			<header className="mb-6 flex items-center justify-between gap-3 animate-enter">
				{selected ? (
					<div className="flex min-w-0 items-center gap-1">
						<TabsNewsletter newsletters={bySize} selectedId={selectedId} />
						<Link
							href={`/newsletters/${selectedId}`}
							aria-label={`${selected.name} settings`}
							title="Newsletter settings"
							className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
						>
							<Settings2 className="size-4" />
						</Link>
					</div>
				) : (
					<span />
				)}
				<div className="shrink-0">
					<ButtonNewCampaign newsletters={toNewsletterOptions(newsletters)} />
				</div>
			</header>

			<div className="flex flex-col gap-8">
				{selected ? (
					<>
						<Section title={`Last ${PERIOD_DAYS} days`} stagger={1}>
							<div className="overflow-hidden rounded-2xl bg-card shadow-border">
								<Suspense key={`stats-${selectedId}`} fallback={<SkeletonStats />}>
									<StatsEmail workspaceId={workspaceId} newsletterId={selected._id} />
								</Suspense>
								<div className="border-t border-border/60">
									<Suspense key={`subscribers-${selectedId}`} fallback={<SkeletonSubscribers />}>
										<CardSubscribers workspaceId={workspaceId} newsletterId={selected._id} timeZone={timeZone} />
									</Suspense>
								</div>
							</div>
						</Section>

						<Section title="Today" stagger={2}>
							<Suspense key={`sends-${selectedId}`} fallback={<SkeletonSends />}>
								<CardSends workspaceId={workspaceId} newsletterId={selected._id} timeZone={timeZone} />
							</Suspense>
						</Section>

						<Section title="This month" stagger={3}>
							<Suspense key="send-cost" fallback={null}>
								<CardSendCost workspaceId={workspaceId} newsletters={newsletters} showCost={session.isPlatformAdmin} />
							</Suspense>
						</Section>

						<Section title="Campaigns" href="/campaigns" stagger={3}>
							<Suspense key={`campaigns-${selectedId}`} fallback={<SkeletonCampaigns rows={5} />}>
								<TableRecentCampaigns workspaceId={workspaceId} newsletterId={selected._id} newsletters={newsletters} />
							</Suspense>
						</Section>
					</>
				) : (
					<StateEmpty icon={Newspaper} title="No newsletters yet">
						<Button asChild variant="outline" size="sm">
							<Link href="/newsletters">Go to newsletters</Link>
						</Button>
					</StateEmpty>
				)}

				<Suspense fallback={null}>
					<SectionUsage workspaceId={workspaceId} />
				</Suspense>

				<Section title="Domains" href="/domains" stagger={4}>
					<Suspense fallback={<SkeletonDomainList />}>
						<SectionDomains workspaceId={workspaceId} />
					</Suspense>
				</Section>

				{/* The SES account is shared by every workspace: its quota and health are the platform owner's. */}
				{session.isPlatformAdmin && (
					<Section title="System" stagger={5}>
						<Suspense fallback={<SkeletonSesAccount />}>
							<StripSesAccount />
						</Suspense>
					</Section>
				)}
			</div>
		</>
	);
}

async function StatsEmail({ workspaceId, newsletterId }) {
	const stats = await getEmailStats({ workspaceId, newsletterId });
	return (
		<div className="animate-fade-in">
			<ListStats current={stats.current} previous={stats.previous} />
		</div>
	);
}

async function CardSubscribers({ workspaceId, newsletterId, timeZone }) {
	const history = await getSubscriberHistory({ workspaceId, newsletterId, timeZone });

	return (
		<div className="flex flex-col gap-6 p-5 animate-fade-in sm:p-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-muted-foreground">Subscribers</h2>
					<p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span className="text-4xl font-semibold tracking-tight tabular-nums">
							{formatNumber(history.total)}
						</span>
						<span className={cn("text-sm font-medium tabular-nums", growthTone(history.growth))}>
							{formatSigned(history.growth)} in {PERIOD_DAYS} days
						</span>
					</p>
				</div>
				<ListLegend
					items={[
						{ swatch: "line", label: `Last ${PERIOD_DAYS} days`, value: formatSigned(history.growth) },
						{ swatch: "dashed", label: `Previous ${PERIOD_DAYS} days`, value: formatSigned(history.previousGrowth) },
					]}
				/>
			</div>
			<ChartSubscribers current={history.current} previous={history.previous} />
		</div>
	);
}

async function CardSends({ workspaceId, newsletterId, timeZone }) {
	const hours = await getHourlySends({ workspaceId, newsletterId, timeZone });
	const sentToday = hours.reduce((sum, { today }) => sum + (today ?? 0), 0);
	const sentYesterday = hours.reduce((sum, { yesterday }) => sum + yesterday, 0);

	return (
		<div className="flex flex-col gap-6 rounded-2xl bg-card p-5 shadow-border animate-fade-in sm:p-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-muted-foreground">Emails sent per hour</h2>
					<p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span className="text-3xl font-semibold tracking-tight tabular-nums">{formatNumber(sentToday)}</span>
						<span className="text-sm text-muted-foreground tabular-nums">
							{formatNumber(sentYesterday)} yesterday
						</span>
					</p>
				</div>
				<ListLegend
					items={[
						{ swatch: "bar", label: "Today" },
						{ swatch: "ghost", label: "Yesterday" },
						{ label: timeZoneLabel(timeZone) },
					]}
				/>
			</div>
			<ChartSends hours={hours} />
		</div>
	);
}

// Amazon bills by the email, so this adds up every newsletter of the workspace. It's an estimate:
// SES's own bill also has small items, and the price is SES_PRICE_PER_1000 (default $0.10).
async function CardSendCost({ workspaceId, newsletters, showCost }) {
	const since = startOfMonth();
	const counts = await Promise.all(
		newsletters.map(({ _id }) =>
			Message.countDocuments({ workspaceId, newsletterId: _id, sentAt: { $gte: since }, kind: { $ne: "test" } })
		)
	);
	const emails = counts.reduce((sum, count) => sum + count, 0);
	const price = getPricePer1000();

	return (
		<div className="animate-fade-in">
			<CardStat
				label="Emails sent this month"
				value={formatNumber(emails)}
				// What each email costs is the platform owner's business, not the client's.
				detail={showCost ? `About ${formatCost(estimateCost(emails, price))} on Amazon SES, at $${price.toFixed(2)} per 1,000` : undefined}
			/>
		</div>
	);
}

async function TableRecentCampaigns({ workspaceId, newsletterId, newsletters }) {
	const campaigns = await Campaign.aggregate(recentCampaignsPipeline(5, workspaceId, newsletterId));
	if (campaigns.length === 0) {
		return (
			<p className="rounded-xl px-4 py-6 text-center text-sm text-muted-foreground shadow-border animate-fade-in">
				No campaigns yet
			</p>
		);
	}

	return (
		<div className="animate-fade-in">
			<TableCampaigns campaigns={campaigns} newsletters={toNewsletterMap(newsletters)} />
		</div>
	);
}

// The allowance the platform owner set, with how much is used. Nothing shows when there are no limits.
async function SectionUsage({ workspaceId }) {
	const usage = await getWorkspaceUsage(workspaceId);
	if (Object.values(usage.limits).every((limit) => limit === null)) return null;
	return (
		<Section title="Your plan" stagger={4}>
			<CardUsage usage={usage} />
		</Section>
	);
}

async function SectionDomains({ workspaceId }) {
	const all = await listSesDomains();
	const domains = all.error ? all : filterDomainsForWorkspace(all, await listWorkspaceDomains(workspaceId));

	if (domains.error || domains.length === 0) {
		return (
			<p className="flex items-center gap-3 rounded-xl px-4 py-4 text-sm text-muted-foreground shadow-border animate-fade-in">
				{domains.error && <TriangleAlert className="size-4 shrink-0 text-amber-500" />}
				<span className="truncate">{domains.error ? `SES unreachable: ${domains.error}` : "No domains in SES"}</span>
			</p>
		);
	}

	return (
		<div className="animate-fade-in">
			<ListDomainStatus domains={domains} />
		</div>
	);
}

function Section({ title, href, stagger, children }) {
	return (
		<section style={{ "--stagger": stagger }} className="flex flex-col gap-3 animate-enter">
			<SectionTitle href={href}>{title}</SectionTitle>
			{children}
		</section>
	);
}

function SectionTitle({ href, children }) {
	if (!href) return <h2 className="text-sm font-medium text-muted-foreground">{children}</h2>;
	return (
		<h2 className="text-sm font-medium text-muted-foreground">
			<Link href={href} className="group inline-flex items-center gap-1 transition-colors hover:text-foreground">
				{children}
				<ChevronRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
			</Link>
		</h2>
	);
}

function ListLegend({ items }) {
	return (
		<ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
			{items.map(({ swatch, label, value }) => (
				<li key={label} className="flex items-center gap-2">
					{swatch && <SwatchChart kind={swatch} />}
					{label}
					{value && <span className="font-medium text-foreground tabular-nums">{value}</span>}
				</li>
			))}
		</ul>
	);
}

function growthTone(value) {
	if (value > 0) return "text-emerald-600 dark:text-emerald-400";
	if (value < 0) return "text-red-600 dark:text-red-400";
	return "text-muted-foreground";
}
