"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { decideReviewAction } from "@/app/(app)/platform/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

// Approve a flagged issue, or turn it down with the reason the sender will read.
export default function ButtonsReview({ campaignId, subject }) {
	const [isRejecting, setIsRejecting] = useState(false);
	const [note, setNote] = useState("");
	const [error, setError] = useState(null);
	const [isPending, startTransition] = useTransition();

	function decide(decision) {
		setError(null);
		startTransition(async () => {
			const result = await decideReviewAction(campaignId, decision, note);
			if (result?.error) return setError(result.error);
			setIsRejecting(false);
			toast.success(decision === "approved" ? "Approved. The sender was told." : "Turned down. The sender was told why.");
		});
	}

	return (
		<>
			<div className="flex gap-2">
				<Button size="sm" onClick={() => decide("approved")} disabled={isPending}>
					{isPending && !isRejecting ? <Loader2 className="animate-spin" /> : <Check data-icon="inline-start" />}
					Approve
				</Button>
				<Button size="sm" variant="outline" onClick={() => setIsRejecting(true)} disabled={isPending}>
					<X data-icon="inline-start" />
					Turn down
				</Button>
			</div>
			{error && !isRejecting && <p className="text-sm text-destructive">{error}</p>}
			<Dialog open={isRejecting} onOpenChange={(open) => !isPending && setIsRejecting(open)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Turn down “{subject || "Untitled"}”?</DialogTitle>
						<DialogDescription>The sender gets this reason by email and can change the issue and try again.</DialogDescription>
					</DialogHeader>
					<Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} placeholder="For example: the link in paragraph two goes to a different site than it shows." />
					{error && <p className="text-sm text-destructive">{error}</p>}
					<DialogFooter>
						<Button variant="ghost" onClick={() => setIsRejecting(false)} disabled={isPending}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={() => decide("rejected")} disabled={isPending || !note.trim()}>
							{isPending ? <Loader2 className="animate-spin" /> : "Turn down"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
