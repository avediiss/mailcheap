"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

// "Are you sure?" for actions that can't be undone. onConfirm returns the action's result: an { error }
// keeps the dialog open and shows it; anything else closes it and shows successMessage.
export default function DialogConfirm({ open, onOpenChange, title, description, confirmLabel = "Confirm", successMessage, onConfirm, destructive = false }) {
	const [error, setError] = useState(null);
	const [isPending, startTransition] = useTransition();

	function confirm() {
		setError(null);
		startTransition(async () => {
			const result = await onConfirm();
			if (result?.error) return void setError(result.error);
			if (successMessage) toast.success(successMessage);
			onOpenChange(false);
		});
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setError(null);
				onOpenChange(next);
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{error && <p className="text-sm text-destructive">{error}</p>}
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
						Cancel
					</Button>
					<Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={isPending} className="min-w-24">
						{isPending ? <Loader2 className="animate-spin" /> : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
