import Link from "next/link";
import { formatRelative } from "@/lib/format";
import { AUDIT_LABELS } from "@/lib/platform-rules";

// What was done and by whom, newest first. workspaceNames: id -> name, to say where (on the platform overview).
export default function ListAudit({ entries, workspaceNames }) {
	if (entries.length === 0) return <p className="rounded-xl px-4 py-6 text-center text-sm text-muted-foreground shadow-border">Nothing yet</p>;
	return (
		<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
			{entries.map((entry) => (
				<li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
					<span className="min-w-0">
						<span className="font-medium">{AUDIT_LABELS[entry.action] ?? entry.action}</span>
						{workspaceNames && entry.workspaceId && (
							<>
								{" "}
								<Link href={`/platform/workspaces/${entry.workspaceId}`} className="text-muted-foreground underline-offset-2 hover:underline">
									{workspaceNames.get(entry.workspaceId) ?? "a workspace"}
								</Link>
							</>
						)}
						{entry.actorEmail && <span className="text-muted-foreground"> · {entry.actorEmail}</span>}
					</span>
					<span className="text-xs text-muted-foreground tabular-nums">{formatRelative(entry.at)}</span>
				</li>
			))}
		</ul>
	);
}
