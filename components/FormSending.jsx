"use client";

import { useActionState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateSendingAction } from "@/app/(app)/platform/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The platform's setting for how fast one client may send: warm up like anyone new (the default), be trusted, or a
// daily amount of your own.
export default function FormSending({ id, isTrusted, dailyCap }) {
	const [state, action, isPending] = useActionState(updateSendingAction, null);

	useEffect(() => {
		if (state?.ok) toast.success("Saved");
	}, [state]);

	return (
		<form action={action} className="flex flex-col gap-4 border-t border-border/60 p-4 sm:p-5">
			<input type="hidden" name="id" value={id} />
			<label className="flex items-start gap-3 text-sm">
				<input type="checkbox" name="isTrusted" defaultChecked={isTrusted} className="mt-0.5 size-4" />
				<span className="flex flex-col gap-0.5">
					<span className="font-medium">Trusted sender</span>
					<span className="text-xs text-pretty text-muted-foreground">
						Skips the warm-up and the daily amount, and sends a whole issue at once. For a client who arrives with a proven, clean list.
					</span>
				</span>
			</label>
			<label className="grid gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center sm:gap-4">
				<span className="text-sm font-medium">Daily amount</span>
				<Input name="dailyCap" defaultValue={dailyCap ?? ""} inputMode="numeric" placeholder="Follow the warm-up" />
			</label>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<div>
				<Button type="submit" variant="outline" disabled={isPending} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Save"}
				</Button>
			</div>
		</form>
	);
}
