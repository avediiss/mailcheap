"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setCampaignAudience } from "@/app/(app)/campaigns/actions";
import { formatNumber } from "@/lib/format";

// "Everyone", or one tag, or one signup source. Picking saves right away and the page recounts.
export default function SelectCampaignAudience({ campaignId, audience, options }) {
	const [isPending, startTransition] = useTransition();
	const current = audience?.tag ? `tag:${audience.tag}` : audience?.source ? `source:${audience.source}` : "";
	const tags = withCurrent(options.tags, audience?.tag);
	const sources = withCurrent(options.sources, audience?.source);
	if (tags.length === 0 && sources.length === 0) return null;

	function change(event) {
		const [kind, ...rest] = event.target.value.split(":");
		const value = rest.join(":");
		startTransition(async () => {
			const result = await setCampaignAudience(campaignId, {
				tag: kind === "tag" ? value : "",
				source: kind === "source" ? value : "",
			});
			if (result?.error) toast.error(result.error);
		});
	}

	return (
		<select
			value={current}
			onChange={change}
			disabled={isPending}
			aria-label="Send to"
			className="h-8 max-w-48 shrink-0 rounded-md border border-border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
		>
			<option value="">Everyone</option>
			{tags.length > 0 && (
				<optgroup label="Tag">
					{tags.map(({ value, count }) => (
						<option key={value} value={`tag:${value}`}>
							{value} ({formatNumber(count)})
						</option>
					))}
				</optgroup>
			)}
			{sources.length > 0 && (
				<optgroup label="Signed up via">
					{sources.map(({ value, count }) => (
						<option key={value} value={`source:${value}`}>
							{value} ({formatNumber(count)})
						</option>
					))}
				</optgroup>
			)}
		</select>
	);
}

// A segment whose contacts have all left still shows as the choice instead of silently reading "Everyone".
function withCurrent(options, selected) {
	if (!selected || options.some(({ value }) => value === selected)) return options;
	return [{ value: selected, count: 0 }, ...options];
}
