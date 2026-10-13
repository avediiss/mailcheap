"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateContact } from "@/app/(app)/contacts/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Opened from a menu, so the caller owns the open state.
export default function DialogEditContact({ id, email, firstName, tags, isOpen, onOpenChange }) {
	const router = useRouter();
	const [name, setName] = useState(firstName ?? "");
	const [labels, setLabels] = useState((tags ?? []).join(", "));
	const [isSaving, startSaving] = useTransition();

	function onSubmit(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await updateContact({ id, firstName: name, tags: labels });
			if (result?.error) return void toast.error(result.error);
			toast.success("Saved");
			onOpenChange(false);
			router.refresh();
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !isSaving && onOpenChange(open)}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Edit contact</DialogTitle>
					<DialogDescription className="break-all">{email}</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSubmit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`first-name-${id}`}>First name</Label>
						<Input
							id={`first-name-${id}`}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Used for {{first_name}} in emails"
							maxLength={60}
							autoComplete="off"
							disabled={isSaving}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`tags-${id}`}>Tags</Label>
						<Input
							id={`tags-${id}`}
							value={labels}
							onChange={(event) => setLabels(event.target.value)}
							placeholder="vip, paris, press"
							autoComplete="off"
							disabled={isSaving}
						/>
						<p className="text-xs text-muted-foreground">
							Separate with commas. A campaign can be sent to one tag only.
						</p>
					</div>
					<DialogFooter>
						<Button type="submit" disabled={isSaving} className="min-w-24">
							{isSaving ? <Loader2 className="animate-spin" /> : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
