"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { getImportProgress } from "@/app/(app)/contacts/actions";
import { formatNumber } from "@/lib/format";

const ACTIVE = ["uploading", "queued", "running"];

// A big import added in the background: how far along it is, then what came of it. Polls while it runs.
export default function PanelImportProgress({ initial }) {
	const router = useRouter();
	const [job, setJob] = useState(initial);
	const [isDismissed, setIsDismissed] = useState(false);

	useEffect(() => {
		if (!job || !ACTIVE.includes(job.status)) return;
		const timer = setInterval(async () => {
			const next = await getImportProgress();
			setJob(next);
			if (next && !ACTIVE.includes(next.status)) router.refresh();
		}, 2500);
		return () => clearInterval(timer);
	}, [job, router]);

	if (!job || isDismissed) return null;
	const isActive = ACTIVE.includes(job.status);
	const percent = job.totalRows ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 100)) : 0;

	return (
		<div role="status" className="flex flex-col gap-2 rounded-xl bg-card p-4 text-sm shadow-border animate-enter">
			<div className="flex items-center gap-2">
				{isActive ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : job.status === "failed" ? <TriangleAlert className="size-4 text-amber-500" /> : <CheckCircle2 className="size-4 text-emerald-600" />}
				<span className="min-w-0 flex-1 truncate font-medium">
					{isActive ? `Importing ${job.fileName || "your file"}` : job.status === "failed" ? "The import stopped" : "Import finished"}
				</span>
				{!isActive && (
					<button type="button" onClick={() => setIsDismissed(true)} className="text-xs text-muted-foreground hover:text-foreground">
						Dismiss
					</button>
				)}
			</div>
			{isActive ? (
				<>
					<div className="h-1.5 overflow-hidden rounded-full bg-muted">
						<div className="h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${Math.max(percent, 2)}%` }} />
					</div>
					<p className="text-xs text-muted-foreground tabular-nums">
						{job.status === "uploading" ? "Uploading the file…" : `${formatNumber(job.processedRows)} of ${formatNumber(job.totalRows)} rows. You can leave this page.`}
					</p>
				</>
			) : job.status === "failed" ? (
				<p className="text-xs text-pretty text-muted-foreground">
					{job.error} {formatNumber(job.created)} were added before it stopped.
				</p>
			) : (
				<p className="text-xs text-pretty text-muted-foreground tabular-nums">
					{formatNumber(job.created)} added, {formatNumber(job.existing)} already there
					{job.skippedOverLimit > 0 && `, ${formatNumber(job.skippedOverLimit)} not added because of the contact limit`}
					{job.invalid > 0 && `, ${formatNumber(job.invalid)} not valid`}
					{job.rejected.typo + job.rejected.disposable + job.rejected.blocked + job.rejected.undeliverable > 0 &&
						`, ${formatNumber(job.rejected.typo + job.rejected.disposable + job.rejected.blocked + job.rejected.undeliverable)} left out (typos, throwaway or blocked domains)`}
					{job.fieldProblems > 0 && `, ${formatNumber(job.fieldProblems)} field values didn't fit their field`}.
				</p>
			)}
		</div>
	);
}
