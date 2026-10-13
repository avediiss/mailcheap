"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deleteContact } from "@/app/(app)/contacts/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { getSuppressionReasonOnDelete } from "@/lib/contact-delete";

// Opened from a menu, so the caller owns the open state.
export default function DialogDeleteContact({ id, email, status, isOpen, onOpenChange }) {
	const router = useRouter();
	const [isDeleting, startDeleting] = useTransition();
	const staysOnList = Boolean(getSuppressionReasonOnDelete(status));

	function remove() {
		startDeleting(async () => {
			const result = await deleteContact(id);
			if (result?.error) return void toast.error(result.error);
			toast.success("Contact deleted");
			onOpenChange(false);
			router.refresh();
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !isDeleting && onOpenChange(open)}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Delete this contact?</DialogTitle>
					<DialogDescription>
						<span className="font-medium break-all text-foreground">{email}</span> is removed from your list,
						with their name, tags and activity. This can&apos;t be undone.
						{staysOnList &&
							" Because they opted out or the address failed, the address alone stays on the do-not-email list, so it can't be added back by mistake."}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Cancel</Button>
					</DialogClose>
					<Button variant="destructive" onClick={remove} disabled={isDeleting} className="min-w-20">
						{isDeleting ? <Loader2 className="animate-spin" /> : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
