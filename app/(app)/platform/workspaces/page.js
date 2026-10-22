import Link from "next/link";
import { Building2 } from "lucide-react";
import AvatarInitials from "@/components/AvatarInitials";
import BadgeHealth from "@/components/BadgeHealth";
import BadgeStatus from "@/components/BadgeStatus";
import DialogCreateWorkspace from "@/components/DialogCreateWorkspace";
import HeaderPage from "@/components/HeaderPage";
import MeterUsage from "@/components/MeterUsage";
import Sparkline from "@/components/Sparkline";
import { Button } from "@/components/ui/button";
import StateEmpty from "@/components/StateEmpty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { listWorkspaceSummaries } from "@/lib/platform";
import { getPlatformInsights } from "@/lib/platform-insights";
import { formatCost } from "@/lib/send-cost";

export const metadata = { title: "Workspaces" };

export default async function WorkspacesPage() {
	await requirePlatformAdmin();
	const rows = await listWorkspaceSummaries();
	const { send } = await getPlatformInsights({ range: 30, names: new Map(rows.map(({ id, name }) => [id, name])) });
	const trend = (id) => send.perWorkspace[id]?.daily ?? Array(30).fill(0);
	const pace = (row) => (row.emailsProjection.state === "over" ? `On pace for ~${formatNumber(row.emailsProjection.projected)}` : null);

	return (
		<>
			<HeaderPage title="Workspaces">
				<DialogCreateWorkspace />
			</HeaderPage>
			{rows.length === 0 ? (
				<StateEmpty icon={Building2} title="No workspaces yet">
					<DialogCreateWorkspace label="Create the first one" />
				</StateEmpty>
			) : (
				<>
				{/* On a phone, each workspace is a card instead of a row of a wide table. */}
				<ul className="flex flex-col gap-3 animate-enter md:hidden">
					{rows.map((row) => (
						<li key={row.id} className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-border">
							<Link href={`/platform/workspaces/${row.id}`} className="flex items-center gap-3">
								<AvatarInitials name={row.name} size={36} shape="square" />
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate font-medium">{row.name}</span>
									<span className="text-xs text-muted-foreground">
										{formatNumber(row.members)} {row.members === 1 ? "person" : "people"} · {formatNumber(row.newsletters)} {row.newsletters === 1 ? "newsletter" : "newsletters"}
									</span>
								</span>
								{row.status === "suspended" && <BadgeStatus status="paused" label="Suspended" />}
							</Link>
							<MeterUsage label="Contacts" meter={row.contactsMeter} compact />
							<MeterUsage label="Emails this month" meter={row.emailsMeter} compact />
							{pace(row) && <p className="-mt-2 text-xs text-amber-600 dark:text-amber-400">{pace(row)} this month, over its limit</p>}
							<div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
								<span className="flex items-center gap-2">
									<Sparkline values={trend(row.id)} label={`${row.name}: emails sent per day, last 30 days`} className="h-6 w-24" />
									30 days
								</span>
								<span className="tabular-nums">{formatCost(row.costThisMonth)} SES this month</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<BadgeHealth health={row.health} />
								<Button asChild variant="outline" size="sm">
									<Link href={`/platform/workspaces/${row.id}`}>Details</Link>
								</Button>
							</div>
						</li>
					))}
				</ul>
				<div className="hidden overflow-x-auto rounded-xl shadow-border animate-enter md:block">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="pl-4">Workspace</TableHead>
								<TableHead className="text-right">People</TableHead>
								<TableHead className="w-40">Contacts</TableHead>
								<TableHead className="w-40">Emails this month</TableHead>
								<TableHead className="w-28">30 days</TableHead>
								<TableHead className="text-right">SES cost</TableHead>
								<TableHead>Deliverability</TableHead>
								<TableHead className="w-24 pr-2" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.id}>
									<TableCell className="py-3 pl-4">
										<Link href={`/platform/workspaces/${row.id}`} className="flex min-w-0 items-center gap-3">
											<AvatarInitials name={row.name} size={32} shape="square" />
											<span className="flex min-w-0 flex-col">
												<span className="flex items-center gap-2 truncate font-medium">
													{row.name}
													{row.status === "suspended" && <BadgeStatus status="paused" label="Suspended" />}
												</span>
												<span className="truncate text-xs text-muted-foreground">{formatNumber(row.newsletters)} {row.newsletters === 1 ? "newsletter" : "newsletters"}</span>
											</span>
										</Link>
									</TableCell>
									<TableCell className="text-right tabular-nums">{formatNumber(row.members)}</TableCell>
									<TableCell>
										<MeterUsage meter={row.contactsMeter} compact />
									</TableCell>
									<TableCell>
										<MeterUsage meter={row.emailsMeter} compact />
										{pace(row) && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{pace(row)}</p>}
									</TableCell>
									<TableCell>
										<Sparkline values={trend(row.id)} label={`${row.name}: emails sent per day, last 30 days`} className="h-7 w-24" />
									</TableCell>
									<TableCell className="text-right text-sm tabular-nums">{formatCost(row.costThisMonth)}</TableCell>
									<TableCell>
										<BadgeHealth health={row.health} />
									</TableCell>
									<TableCell className="pr-2 text-right">
										<Button asChild variant="outline" size="sm">
											<Link href={`/platform/workspaces/${row.id}`}>Details</Link>
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
				</>
			)}
		</>
	);
}
