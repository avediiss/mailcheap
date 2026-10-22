import { Suspense } from "react";
import { ChevronRight, ExternalLink, Globe, TriangleAlert } from "lucide-react";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonCopy from "@/components/ButtonCopy";
import ButtonRefresh from "@/components/ButtonRefresh";
import DialogAddDomain from "@/components/DialogAddDomain";
import HeaderPage from "@/components/HeaderPage";
import ImageFavicon from "@/components/ImageFavicon";
import ButtonSetUpDomain from "@/components/ButtonSetUpDomain";
import MenuDomain from "@/components/MenuDomain";
import SkeletonDomains from "@/components/SkeletonDomains";
import StateEmpty from "@/components/StateEmpty";
import { Button } from "@/components/ui/button";
import { listWorkspaceDomainStatuses } from "@/lib/domains";
import { rootDomain } from "@/lib/favicon";
import { requireWorkspace } from "@/lib/workspace";
import { hasRole } from "@/lib/workspace-rules";

export const metadata = { title: "Domains" };

export default async function DomainsPage() {
	const { workspaceId, role, isSuspended } = await requireWorkspace();
	const canManage = hasRole(role, "owner") && !isSuspended;

	return (
		<>
			<HeaderPage title="Domains">
				<Button asChild variant="outline">
					<a href="https://postmaster.google.com/v2/" target="_blank" rel="noreferrer">
						<ImageFavicon domain="postmaster.google.com" size={16} />
						Postmaster
						<ExternalLink data-icon="inline-end" className="opacity-60" />
					</a>
				</Button>
				{canManage && <DialogAddDomain />}
			</HeaderPage>
			<p className="-mt-4 mb-6 max-w-2xl text-sm text-pretty text-muted-foreground animate-enter">
				You can only send from addresses on these domains. Add one, then create the DNS records it shows you where you manage the
				domain. Once they’re in place it turns verified.
			</p>
			<Suspense fallback={<SkeletonDomains />}>
				<ListDomains workspaceId={workspaceId} canManage={canManage} />
			</Suspense>
		</>
	);
}

async function ListDomains({ workspaceId, canManage }) {
	const { domains, sesError } = await listWorkspaceDomainStatuses(workspaceId, { fresh: true });

	if (domains.length === 0 && !sesError) {
		return (
			<StateEmpty icon={Globe} title="No domains yet">
				<p className="max-w-sm text-sm text-pretty text-muted-foreground">
					{canManage ? "Add the domain you want to send from to get started." : "An owner of this workspace needs to add one."}
				</p>
				{canManage && <DialogAddDomain label="Add your first domain" />}
			</StateEmpty>
		);
	}

	const hasPending = domains.some(({ status }) => status.key === "pending");

	return (
		<div className="flex flex-col gap-3">
			{sesError && (
				<div role="status" className="flex items-start gap-3 rounded-xl bg-amber-500/10 px-4 py-3 text-sm shadow-border animate-enter">
					<TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
					<p className="text-pretty">
						<span className="font-medium">The sending service couldn’t be reached.</span>{" "}
						<span className="text-muted-foreground">Verification status is unknown for now. {sesError}</span>
					</p>
				</div>
			)}
			{domains.map((domain, index) => (
				<section key={domain.id} style={{ "--stagger": index }} className="overflow-hidden rounded-xl bg-card shadow-border animate-enter">
					<div className="flex flex-wrap items-center justify-between gap-3 p-4">
						<div className="flex min-w-0 items-center gap-3">
							<div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
								<ImageFavicon domain={rootDomain(domain.domain)} size={20} />
							</div>
							<div className="flex min-w-0 flex-col">
								<p className="truncate font-medium">{domain.domain}</p>
								<p className="truncate text-xs text-muted-foreground">{domain.status.hint}</p>
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{domain.dkimStatus && <StatusPill label="DKIM" status={domain.dkimStatus} />}
							{domain.mailFromDomain && <StatusPill label="Return path" status={domain.mailFromStatus} />}
							{canManage && domain.status.key === "missing" && <ButtonSetUpDomain id={domain.id} />}
							<BadgeStatus status={domain.status.key} label={domain.status.label} />
							{canManage && <MenuDomain id={domain.id} domain={domain.domain} />}
						</div>
					</div>

					{domain.records.length > 0 && (
						<details className="group border-t border-border/60" open={domain.status.key === "pending"}>
							<summary className="flex h-11 cursor-pointer list-none items-center gap-1.5 px-4 text-sm text-muted-foreground transition-colors duration-150 select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
								<ChevronRight className="size-4 transition-transform duration-200 group-open:rotate-90" />
								DNS records
							</summary>
							<div className="overflow-x-auto border-t border-border/60">
								<table className="w-full text-sm">
									<tbody className="divide-y divide-border/60">
										{domain.records.map((record) => (
											<tr key={`${record.type}-${record.name}-${record.value}`}>
												<td className="w-16 py-2 pl-4 align-middle font-mono text-xs text-muted-foreground">{record.type}</td>
												<td className="max-w-0 py-2 pr-2 align-middle">
													<div className="flex items-center gap-1">
														<span className="truncate font-mono text-xs">{record.name}</span>
														<ButtonCopy value={record.name} label="Copy name" />
													</div>
												</td>
												<td className="max-w-0 py-2 pr-4 align-middle">
													<div className="flex items-center gap-1">
														<span className="truncate font-mono text-xs">{record.value}</span>
														<ButtonCopy value={record.value} label="Copy value" />
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</details>
					)}
				</section>
			))}
			{hasPending && (
				<div className="flex flex-wrap items-center justify-between gap-3 pt-1 animate-enter">
					<p className="text-sm text-pretty text-muted-foreground">DNS changes can take a few minutes, sometimes a few hours, to show up.</p>
					<ButtonRefresh />
				</div>
			)}
		</div>
	);
}

function StatusPill({ label, status }) {
	const key = String(status ?? "").toLowerCase();
	return <BadgeStatus status={key} label={`${label} ${key === "success" ? "ok" : key.replaceAll("_", " ") || "missing"}`} />;
}
