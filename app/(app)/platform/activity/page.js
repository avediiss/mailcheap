import Link from "next/link";
import { isValidObjectId } from "mongoose";
import HeaderPage from "@/components/HeaderPage";
import ListAudit from "@/components/ListAudit";
import { listAuditPage } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { listWorkspaceSummaries } from "@/lib/platform";
import { AUDIT_LABELS } from "@/lib/platform-rules";

export const metadata = { title: "Activity" };

const selectClass = "h-9 rounded-lg bg-card px-2.5 text-sm shadow-border outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export default async function ActivityPage({ searchParams }) {
	await requirePlatformAdmin();
	const params = (await searchParams) ?? {};
	const workspaceId = isValidObjectId(params.workspace) ? String(params.workspace) : "";
	const action = Object.hasOwn(AUDIT_LABELS, params.action) ? params.action : "";
	const before = typeof params.before === "string" ? params.before : "";

	const [rows, { entries, nextBefore }] = await Promise.all([listWorkspaceSummaries(), listAuditPage({ workspaceId, action, before })]);
	const names = new Map(rows.map(({ id, name }) => [id, name]));
	const older = new URLSearchParams({ ...(workspaceId && { workspace: workspaceId }), ...(action && { action }), before: nextBefore ?? "" });

	return (
		<>
			<HeaderPage title="Activity">
				<form action="/platform/activity" className="flex flex-wrap items-center gap-2">
					<select name="workspace" defaultValue={workspaceId} aria-label="Workspace" className={selectClass}>
						<option value="">All workspaces</option>
						{rows.map(({ id, name }) => (
							<option key={id} value={id}>
								{name}
							</option>
						))}
					</select>
					<select name="action" defaultValue={action} aria-label="Action" className={selectClass}>
						<option value="">All actions</option>
						{Object.entries(AUDIT_LABELS).map(([key, label]) => (
							<option key={key} value={key}>
								{label}
							</option>
						))}
					</select>
					<button type="submit" className="h-9 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90">
						Filter
					</button>
					{(workspaceId || action) && (
						<Link href="/platform/activity" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
							Clear
						</Link>
					)}
				</form>
			</HeaderPage>
			<p className="-mt-4 mb-6 max-w-2xl text-sm text-pretty text-muted-foreground animate-enter">Everything an administrator did to a workspace, an account or the team, newest first. It is kept for good.</p>
			<div className="flex max-w-3xl flex-col gap-4 animate-enter">
				<ListAudit entries={entries} workspaceNames={names} />
				{nextBefore && (
					<Link href={`/platform/activity?${older}`} className="self-start rounded-lg px-3 py-2 text-sm font-medium shadow-border transition-colors duration-150 hover:bg-muted/50">
						Older
					</Link>
				)}
			</div>
		</>
	);
}
