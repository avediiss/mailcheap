"use client";

import Link from "next/link";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

// Step 6. What the radar will work from, as the founder left it. Every row goes back to the step that owns
// it, because this is the screen where someone notices the keywords are wrong.
const PLATFORM_LABELS = { x: "X", reddit: "Reddit", hn: "Hacker News", other: "Other" };

function Row({ title, step, onEdit, children }) {
	return (
		<div className="flex flex-col gap-1.5 px-4 py-3.5">
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
				<button
					type="button"
					onClick={() => onEdit(step)}
					className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
				>
					<Pencil className="size-3" aria-hidden="true" />
					Edit
				</button>
			</div>
			{children}
		</div>
	);
}

export default function CardGtmSummary({ state, onEdit }) {
	const { product, sources, samples } = state;
	const activeSources = sources.filter(({ active }) => active);

	return (
		<div className="flex flex-col gap-6 animate-enter">
			<div className="flex items-start gap-3 rounded-xl bg-emerald-500/10 px-4 py-3.5">
				<span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
					<Check className="size-3.5" aria-hidden="true" />
				</span>
				<div>
					<p className="text-sm font-medium">Profile ready</p>
					<p className="mt-0.5 text-sm text-muted-foreground">
						The radar scans every three hours and will start finding posts worth replying to. Nothing is posted
						without you.
					</p>
					{/* The daily screen, once this one-off is done. */}
					<Button asChild size="sm" className="mt-2.5">
						<Link href="/gtm/radar">See what the radar found</Link>
					</Button>
				</div>
			</div>

			<div className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl shadow-border">
				<Row title="Product" step={0} onEdit={onEdit}>
					<p className="text-sm font-medium">{product?.name || product?.url}</p>
					<p className="text-sm text-muted-foreground">{product?.oneLinePitch}</p>
				</Row>

				<Row title="Who it's for" step={2} onEdit={onEdit}>
					<p className="text-sm">{product?.targetCustomer}</p>
				</Row>

				<Row title="Problems it solves" step={2} onEdit={onEdit}>
					<ul className="flex flex-col gap-0.5 text-sm">
						{(product?.pains ?? []).map((pain) => (
							<li key={pain} className="flex gap-2">
								<span aria-hidden="true" className="text-muted-foreground">
									—
								</span>
								{pain}
							</li>
						))}
					</ul>
				</Row>

				<Row title={`Keywords (${product?.keywords?.length ?? 0})`} step={2} onEdit={onEdit}>
					<ul className="flex flex-wrap gap-1.5">
						{(product?.keywords ?? []).map((keyword) => (
							<li key={keyword} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
								{keyword}
							</li>
						))}
					</ul>
				</Row>

				<Row title={`Watching (${activeSources.length})`} step={3} onEdit={onEdit}>
					{activeSources.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing switched on — the radar has nowhere to look.</p>
					) : (
						<ul className="flex flex-col gap-0.5 text-sm">
							{activeSources.map((source) => (
								<li key={source._id} className="flex items-center gap-2">
									<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
										{PLATFORM_LABELS[source.platform]}
									</span>
									<span className="truncate">{source.identifier}</span>
								</li>
							))}
						</ul>
					)}
				</Row>

				<Row title={`Your voice (${samples.length} samples)`} step={4} onEdit={onEdit}>
					<p className="truncate text-sm text-muted-foreground">
						{samples[0]?.text ?? "No samples — replies would not sound like you."}
					</p>
				</Row>
			</div>
		</div>
	);
}
