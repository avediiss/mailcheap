"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addWatchedSources, toggleWatchedSource } from "@/app/(app)/gtm/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { readWatchedSource } from "@/lib/gtm/platforms";

// Step 4. Paste links to accounts and communities. The platform is detected as they type, so they can see
// what each line will become before saving it — and a line we can't read is shown rather than dropped.
const PLATFORM_LABELS = { x: "X", reddit: "Reddit", hn: "Hacker News", other: "Other" };

export default function FormGtmSources({ sources, onDone }) {
	const router = useRouter();
	const [pasted, setPasted] = useState("");
	const [isSaving, startSaving] = useTransition();
	const [isToggling, startToggling] = useTransition();

	const lines = pasted
		.split(/[\n,]/)
		.map((line) => line.trim())
		.filter(Boolean);
	// The same detection the server runs, so the preview can't disagree with what gets saved.
	const previews = lines.map((line) => ({ line, ...readWatchedSource(line) }));

	function onSubmit(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await addWatchedSources({ urls: lines });
			if (result?.error) return toast.error(result.error);

			const added = result.sources?.length ?? 0;
			toast.success(`Watching ${added} ${added === 1 ? "place" : "places"}`);
			// What couldn't be read stays in the box so it can be corrected rather than retyped.
			setPasted((result.problems ?? []).map(({ input }) => input).join("\n"));
			router.refresh();
			if ((result.problems ?? []).length === 0) onDone();
		});
	}

	function onToggle(sourceId, active) {
		startToggling(async () => {
			const result = await toggleWatchedSource({ sourceId, active });
			if (result?.error) return toast.error(result.error);
			router.refresh();
		});
	}

	return (
		<div className="flex flex-col gap-6 animate-enter">
			{sources.length > 0 && (
				<ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl shadow-border">
					{sources.map((source) => (
						<li key={source._id} className="flex items-center justify-between gap-3 px-4 py-3">
							<span className="flex min-w-0 flex-col">
								<span className="truncate text-sm font-medium">{source.identifier}</span>
								<span className="truncate text-xs text-muted-foreground">{PLATFORM_LABELS[source.platform]}</span>
							</span>
							<Switch
								checked={source.active}
								onCheckedChange={(checked) => onToggle(source._id, checked)}
								disabled={isToggling}
								aria-label={`Watch ${source.identifier}`}
							/>
						</li>
					))}
				</ul>
			)}

			<form onSubmit={onSubmit} className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="gtm-sources">Accounts and communities to watch</Label>
					<Textarea
						id="gtm-sources"
						rows={5}
						placeholder={"x.com/someone\nreddit.com/r/freelance\nnews.ycombinator.com"}
						value={pasted}
						onChange={(event) => setPasted(event.target.value)}
						disabled={isSaving}
					/>
					<p className="text-xs text-muted-foreground">One per line. X, Reddit and Hacker News are read today.</p>
				</div>

				{previews.length > 0 && (
					<ul className="flex flex-col gap-1.5">
						{previews.map(({ line, value, error }, index) => (
							<li key={index} className="flex items-center gap-2 text-xs">
								<span
									className={
										error
											? "shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive"
											: "shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium"
									}
								>
									{error ? "Can't read" : PLATFORM_LABELS[value.platform]}
								</span>
								<span className="truncate text-muted-foreground">{error ?? value.identifier}</span>
								<span className="sr-only">{line}</span>
							</li>
						))}
					</ul>
				)}

				<div className="flex flex-wrap items-center gap-2">
					<Button type="submit" disabled={isSaving || lines.length === 0}>
						{isSaving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}
						{isSaving ? "Saving…" : "Watch these"}
					</Button>
					{sources.length > 0 && (
						<Button type="button" variant="ghost" onClick={onDone} disabled={isSaving}>
							Continue
						</Button>
					)}
				</div>
			</form>
		</div>
	);
}
