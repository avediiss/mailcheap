"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessagesSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { askInterviewQuestions, submitInterviewAnswers } from "@/app/(app)/gtm/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Step 2. Three or four questions about what the website didn't make clear, and the answers, which go back
// to refine the profile. Every answer is optional: skipping them all keeps the profile the site gave us.
export default function FormGtmInterview({ interview, onDone }) {
	const router = useRouter();
	const [questions, setQuestions] = useState(interview?.questions ?? []);
	const [interviewId, setInterviewId] = useState(interview?._id ?? "");
	const [answers, setAnswers] = useState(() => (interview?.questions ?? []).map((_, index) => interview?.answers?.[index] ?? ""));
	const [isAsking, startAsking] = useTransition();
	const [isSaving, startSaving] = useTransition();

	function onAsk() {
		startAsking(async () => {
			const result = await askInterviewQuestions();
			if (result?.error) return toast.error(result.error);

			setQuestions(result.questions);
			setInterviewId(result.interviewId);
			setAnswers(result.questions.map(() => ""));
			router.refresh();
		});
	}

	function onSubmit(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await submitInterviewAnswers({ interviewId, answers });
			if (result?.error) return toast.error(result.error);

			toast.success(result.refined ? "Profile updated from your answers" : "Skipped — keeping what your site said");
			router.refresh();
			onDone();
		});
	}

	if (questions.length === 0) {
		return (
			<div className="flex flex-col items-start gap-4 rounded-xl px-6 py-10 shadow-border animate-enter">
				<div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
					<MessagesSquare className="size-5" aria-hidden="true" />
				</div>
				<div>
					<p className="text-sm font-medium">A few questions about your product</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Your site answered some of this already. These are the parts it left open — who exactly it&apos;s for,
						the problem they feel, and what makes it different.
					</p>
				</div>
				<Button type="button" onClick={onAsk} disabled={isAsking}>
					{isAsking ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Sparkles data-icon="inline-start" />}
					{isAsking ? "Writing the questions…" : "Ask me the questions"}
				</Button>
			</div>
		);
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-6 animate-enter">
			{questions.map((question, index) => (
				<div key={index} className="flex flex-col gap-2">
					<Label htmlFor={`gtm-answer-${index}`}>{question}</Label>
					<Textarea
						id={`gtm-answer-${index}`}
						rows={3}
						value={answers[index] ?? ""}
						onChange={(event) =>
							setAnswers((current) => current.map((answer, position) => (position === index ? event.target.value : answer)))
						}
						disabled={isSaving}
					/>
				</div>
			))}
			<div className="flex flex-wrap items-center gap-2">
				<Button type="submit" disabled={isSaving}>
					{isSaving && <Loader2 data-icon="inline-start" className="animate-spin" />}
					{isSaving ? "Saving…" : "Save answers"}
				</Button>
				<Button type="button" variant="ghost" onClick={onDone} disabled={isSaving}>
					Skip
				</Button>
				<p className="text-xs text-muted-foreground">Answer what you can — a blank box changes nothing.</p>
			</div>
		</form>
	);
}
