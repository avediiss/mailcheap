import Link from "next/link";
import { Globe, TriangleAlert } from "lucide-react";
import BadgeStatus from "@/components/BadgeStatus";
import HeaderPage from "@/components/HeaderPage";
import StateEmpty from "@/components/StateEmpty";
import { requirePlatformAdmin } from "@/lib/auth";
import { listPlatformDomains, STUCK_AFTER_DAYS } from "@/lib/platform-domains";

export const metadata = { title: "Domains" };

const STATUS_TONES = { verified: "active", pending: "pending", missing: "paused", unknown: "paused" };

export default async function PlatformDomainsPage() {
	await requirePlatformAdmin();
	const { sesError, domains, unassigned } = await listPlatformDomains();
	const stuck = domains.filter(({ isStuck }) => isStuck);

	return (
		<>
			<HeaderPage title="Domains" />
			<p className="-mt-4 mb-6 max-w-2xl text-sm text-pretty text-muted-foreground animate-enter">
				Every client’s sending domain and whether Amazon SES has verified it. A domain still waiting after {STUCK_AFTER_DAYS} days usually means its owner hasn’t added the DNS records.
			</p>

			<div className="flex max-w-3xl flex-col gap-6 animate-enter">
				{sesError && (
					<p className="flex items-center gap-3 rounded-xl px-4 py-4 text-sm text-muted-foreground shadow-border">
						<TriangleAlert className="size-4 shrink-0 text-amber-500" />
						<span className="truncate">SES unreachable: {sesError}</span>
					</p>
				)}
				{stuck.length > 0 && (
					<p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
						<TriangleAlert className="size-4 shrink-0" />
						{stuck.length} {stuck.length === 1 ? "domain is" : "domains are"} still not verified after {STUCK_AFTER_DAYS}+ days.
					</p>
				)}

				{domains.length === 0 ? (
					<StateEmpty icon={Globe} title="No domains yet" />
				) : (
					<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
						{domains.map((domain) => (
							<li key={domain.id}>
								<Link href={`/platform/workspaces/${domain.workspaceId}`} className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/50">
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate font-mono text-sm font-medium">{domain.domain}</span>
										<span className="truncate text-xs text-muted-foreground">
											{domain.workspaceName} · added {domain.ageDays === 0 ? "today" : `${domain.ageDays} ${domain.ageDays === 1 ? "day" : "days"} ago`}
											{domain.isStuck ? " · waiting too long" : ""}
										</span>
									</span>
									<span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{domain.dkimStatus ? `DKIM ${domain.dkimStatus.toLowerCase().replaceAll("_", " ")}` : ""}</span>
									<BadgeStatus status={STATUS_TONES[domain.status.key] ?? "paused"} label={domain.status.label} />
								</Link>
							</li>
						))}
					</ul>
				)}

				{unassigned.length > 0 && (
					<section className="flex flex-col gap-2">
						<h2 className="text-sm font-medium text-muted-foreground">In SES but not assigned to a workspace</h2>
						<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
							{unassigned.map(({ domain, verified }) => (
								<li key={domain} className="flex items-center justify-between gap-3 px-4 py-3">
									<span className="font-mono text-sm">{domain}</span>
									<BadgeStatus status={verified ? "active" : "pending"} label={verified ? "Verified" : "Pending"} />
								</li>
							))}
						</ul>
						<p className="text-xs text-muted-foreground">Assign one from the workspace’s page. Until then nobody can send from it.</p>
					</section>
				)}
			</div>
		</>
	);
}
