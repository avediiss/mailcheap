import Link from "next/link";
import AvatarInitials from "@/components/AvatarInitials";

// A short ranked list of workspaces: the name, a line under it, and a number. empty: what to say with no rows.
export default function ListWorkspaceRank({ title, hint, rows, empty }) {
	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-col gap-0.5">
				<h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
				{hint && <p className="text-xs text-pretty text-muted-foreground/80">{hint}</p>}
			</div>
			{rows.length === 0 ? (
				<p className="rounded-xl px-4 py-5 text-sm text-muted-foreground shadow-border">{empty}</p>
			) : (
				<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
					{rows.map((row) => (
						<li key={row.id}>
							<Link href={`/platform/workspaces/${row.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/50">
								<AvatarInitials name={row.name} size={28} shape="square" />
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm font-medium">{row.name}</span>
									{row.detail && <span className="truncate text-xs text-muted-foreground">{row.detail}</span>}
								</span>
								{row.value && <span className="shrink-0 text-sm font-medium tabular-nums">{row.value}</span>}
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
