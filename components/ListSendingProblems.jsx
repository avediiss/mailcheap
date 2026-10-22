import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { formatRelative } from "@/lib/format";

// What isn't going out as it should. Each row links to the workspace it is about.
export default function ListSendingProblems({ problems, workspaceNames }) {
	return (
		<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
			{problems.map((problem, index) => (
				<li key={`${problem.kind}-${problem.workspaceId}-${index}`}>
					<Link href={`/platform/workspaces/${problem.workspaceId}`} className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/50">
						<TriangleAlert className="size-4 shrink-0 text-amber-500" />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm font-medium">
								{problem.title} <span className="font-normal text-muted-foreground">· {workspaceNames.get(problem.workspaceId) ?? "a workspace"}</span>
							</span>
							<span className="truncate text-xs text-muted-foreground">{problem.detail}</span>
						</span>
						<span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatRelative(problem.at)}</span>
					</Link>
				</li>
			))}
		</ul>
	);
}
