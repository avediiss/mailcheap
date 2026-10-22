"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { assignDomain } from "@/app/(app)/platform/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// For setting a client up before they log in: gives the workspace a sending domain, even one that already exists
// in the sending service.
export default function FormAssignDomain({ id }) {
	const [state, action, isPending] = useActionState(assignDomain, null);
	const form = useRef(null);

	useEffect(() => {
		if (!state?.ok) return;
		toast.success(`${state.domain} assigned`);
		form.current?.reset();
	}, [state]);

	return (
		<form ref={form} action={action} className="mt-2 flex flex-col gap-2">
			<input type="hidden" name="id" value={id} />
			<div className="flex gap-2">
				<Input name="domain" placeholder="Assign a domain" autoComplete="off" autoCapitalize="none" spellCheck={false} className="h-8 text-sm" aria-label="Domain to assign" />
				<Button type="submit" size="sm" variant="outline" disabled={isPending}>
					{isPending ? <Loader2 className="animate-spin" /> : "Assign"}
				</Button>
			</div>
			{state?.error && <p className="text-xs text-pretty text-destructive">{state.error}</p>}
		</form>
	);
}
