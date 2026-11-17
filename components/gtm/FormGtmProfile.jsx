"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { saveProductProfile } from "@/app/(app)/gtm/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GTM_LIMITS } from "@/lib/gtm/config";

// Step 3. Everything the AI drafted, editable. The founder's version is the one that gets stored and the
// one the radar searches on, so nothing here re-asks the AI.
export default function FormGtmProfile({ product, onDone }) {
	const router = useRouter();
	const [name, setName] = useState(product?.name ?? "");
	const [oneLinePitch, setOneLinePitch] = useState(product?.oneLinePitch ?? "");
	const [targetCustomer, setTargetCustomer] = useState(product?.targetCustomer ?? "");
	const [differentiators, setDifferentiators] = useState(product?.differentiators ?? "");
	// Always three boxes: the shape is part of the ask, so an empty one reads as a gap to fill.
	const [pains, setPains] = useState(() =>
		Array.from({ length: GTM_LIMITS.maxPains }, (_, index) => product?.pains?.[index] ?? "")
	);
	const [keywords, setKeywords] = useState(product?.keywords ?? []);
	const [keywordDraft, setKeywordDraft] = useState("");
	const [isSaving, startSaving] = useTransition();

	function addKeyword() {
		// A pasted "a, b, c" becomes three tags, which is how people paste them.
		const added = keywordDraft
			.split(",")
			.map((word) => word.trim().toLowerCase())
			.filter(Boolean);
		if (added.length === 0) return;

		setKeywords((current) => [...new Set([...current, ...added])].slice(0, GTM_LIMITS.maxKeywords));
		setKeywordDraft("");
	}

	function onKeywordKeyDown(event) {
		// Enter adds a tag rather than submitting the whole form, and Backspace in an empty box removes the last.
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			addKeyword();
			return;
		}
		if (event.key === "Backspace" && !keywordDraft) setKeywords((current) => current.slice(0, -1));
	}

	function onSubmit(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await saveProductProfile({ name, oneLinePitch, targetCustomer, differentiators, pains, keywords });
			if (result?.error) return toast.error(result.error);

			toast.success("Profile saved");
			router.refresh();
			onDone();
		});
	}

	const keywordCount = keywords.length;
	const needsMoreKeywords = keywordCount < GTM_LIMITS.minKeywords;

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-6 animate-enter">
			<div className="flex flex-col gap-2">
				<Label htmlFor="gtm-name">Product name</Label>
				<Input id="gtm-name" value={name} onChange={(event) => setName(event.target.value)} disabled={isSaving} />
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor="gtm-pitch">In one line</Label>
				<Textarea
					id="gtm-pitch"
					rows={2}
					value={oneLinePitch}
					onChange={(event) => setOneLinePitch(event.target.value)}
					disabled={isSaving}
					required
				/>
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor="gtm-customer">Who it&apos;s for</Label>
				<Textarea
					id="gtm-customer"
					rows={2}
					value={targetCustomer}
					onChange={(event) => setTargetCustomer(event.target.value)}
					disabled={isSaving}
					required
				/>
			</div>

			<fieldset className="flex flex-col gap-2">
				<legend className="mb-2 text-sm leading-none font-medium">The three problems it solves</legend>
				{pains.map((pain, index) => (
					<Input
						key={index}
						aria-label={`Problem ${index + 1}`}
						placeholder={`Problem ${index + 1}`}
						value={pain}
						onChange={(event) =>
							setPains((current) => current.map((entry, position) => (position === index ? event.target.value : entry)))
						}
						disabled={isSaving}
					/>
				))}
			</fieldset>

			<div className="flex flex-col gap-2">
				<Label htmlFor="gtm-differentiators">What makes it different</Label>
				<Textarea
					id="gtm-differentiators"
					rows={3}
					value={differentiators}
					onChange={(event) => setDifferentiators(event.target.value)}
					disabled={isSaving}
					required
				/>
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor="gtm-keywords">
					Keywords{" "}
					<span className="font-normal text-muted-foreground">
						({keywordCount} of {GTM_LIMITS.minKeywords}–{GTM_LIMITS.maxKeywords})
					</span>
				</Label>
				{keywordCount > 0 && (
					<ul className="flex flex-wrap gap-1.5">
						{keywords.map((keyword) => (
							<li key={keyword}>
								<span className="flex h-7 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-xs font-medium">
									{keyword}
									<button
										type="button"
										aria-label={`Remove ${keyword}`}
										onClick={() => setKeywords((current) => current.filter((entry) => entry !== keyword))}
										disabled={isSaving}
										className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-foreground/10 hover:text-foreground"
									>
										<X className="size-3" aria-hidden="true" />
									</button>
								</span>
							</li>
						))}
					</ul>
				)}
				<div className="flex gap-2">
					<Input
						id="gtm-keywords"
						placeholder="late invoices, chasing payment"
						value={keywordDraft}
						onChange={(event) => setKeywordDraft(event.target.value)}
						onKeyDown={onKeywordKeyDown}
						disabled={isSaving || keywordCount >= GTM_LIMITS.maxKeywords}
					/>
					<Button
						type="button"
						variant="outline"
						onClick={addKeyword}
						disabled={isSaving || !keywordDraft.trim() || keywordCount >= GTM_LIMITS.maxKeywords}
					>
						<Plus data-icon="inline-start" />
						Add
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					What someone would type when they have this problem — not your product&apos;s name. Press Enter after each.
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<Button type="submit" disabled={isSaving || needsMoreKeywords}>
					{isSaving && <Loader2 data-icon="inline-start" className="animate-spin" />}
					{isSaving ? "Saving…" : "Save profile"}
				</Button>
				{needsMoreKeywords && (
					<p className="text-xs text-muted-foreground">
						{GTM_LIMITS.minKeywords - keywordCount} more keyword{GTM_LIMITS.minKeywords - keywordCount === 1 ? "" : "s"} to go.
					</p>
				)}
			</div>
		</form>
	);
}
