"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveVoice } from "@/app/(app)/gtm/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VOICE_SAMPLE_RULES } from "@/lib/gtm/voice-samples";

// Step 5. Three to five things the founder actually wrote. These go into the drafting prompt verbatim, so
// the length rule is the point rather than bureaucracy: a one-liner teaches a model nothing about a voice.
export default function FormGtmVoice({ samples, onDone }) {
	const router = useRouter();
	const [texts, setTexts] = useState(() =>
		Array.from({ length: VOICE_SAMPLE_RULES.max }, (_, index) => samples?.[index]?.text ?? "")
	);
	const [problems, setProblems] = useState({});
	const [isSaving, startSaving] = useTransition();

	const filledCount = texts.filter((text) => text.trim()).length;

	function onSubmit(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await saveVoice({ texts });

			if (result?.problems) {
				// Shown against the box it belongs to, rather than as one message about "a sample".
				setProblems(Object.fromEntries(result.problems.map(({ index, error }) => [index, error])));
				return toast.error("Some samples need another look");
			}
			setProblems({});
			if (result?.error) return toast.error(result.error);

			toast.success("Profile ready");
			router.refresh();
			onDone();
		});
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-6 animate-enter">
			<p className="text-sm text-muted-foreground">
				Paste {VOICE_SAMPLE_RULES.min} to {VOICE_SAMPLE_RULES.max} things you wrote yourself — a post, a reply, part
				of an email. Replies are drafted to sound like these, so pick the ones that sound like you rather than the
				ones you are proudest of.
			</p>

			{texts.map((text, index) => {
				const length = text.trim().length;
				const problem = problems[index];
				const isOptional = index >= VOICE_SAMPLE_RULES.min;

				return (
					<div key={index} className="flex flex-col gap-2">
						<Label htmlFor={`gtm-voice-${index}`}>
							Sample {index + 1}
							{isOptional && <span className="font-normal text-muted-foreground"> (optional)</span>}
						</Label>
						<Textarea
							id={`gtm-voice-${index}`}
							rows={4}
							value={text}
							onChange={(event) =>
								setTexts((current) => current.map((entry, position) => (position === index ? event.target.value : entry)))
							}
							disabled={isSaving}
							aria-invalid={problem ? true : undefined}
							aria-describedby={`gtm-voice-${index}-hint`}
						/>
						<p
							id={`gtm-voice-${index}-hint`}
							className={problem ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
						>
							{problem ?? (length === 0 ? `${VOICE_SAMPLE_RULES.minLength} characters or more` : `${length} characters`)}
						</p>
					</div>
				);
			})}

			<div className="flex flex-wrap items-center gap-2">
				<Button type="submit" disabled={isSaving || filledCount < VOICE_SAMPLE_RULES.min}>
					{isSaving && <Loader2 data-icon="inline-start" className="animate-spin" />}
					{isSaving ? "Saving…" : "Finish"}
				</Button>
				{filledCount < VOICE_SAMPLE_RULES.min && (
					<p className="text-xs text-muted-foreground">{VOICE_SAMPLE_RULES.min - filledCount} more to go.</p>
				)}
			</div>
		</form>
	);
}
