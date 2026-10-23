"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { addBlockedDomainAction, removeBlockedDomainAction } from "@/app/(app)/platform/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Email domains refused at signup and import for every client, on top of the built-in list of throwaway domains.
export default function ListBlockedDomains({ domains }) {
	const [state, action, isAdding] = useActionState(addBlockedDomainAction, null);
	const [isRemoving, startRemoving] = useTransition();
	const form = useRef(null);

	useEffect(() => {
		if (!state?.ok) return;
		toast.success(`${state.domain} blocked`);
		form.current?.reset();
	}, [state]);

	function remove(domain) {
		startRemoving(async () => {
			const result = await removeBlockedDomainAction(domain);
			if (result?.error) toast.error(result.error);
			else toast.success(`${domain} unblocked`);
		});
	}

	return (
		<div className="flex flex-col gap-3">
			<form ref={form} action={action} className="flex flex-wrap gap-2">
				<Input name="domain" placeholder="spam-source.example" aria-label="Domain to block" autoComplete="off" autoCapitalize="none" spellCheck={false} className="h-9 w-56 text-sm" />
				<Input name="reason" placeholder="Why (optional)" aria-label="Reason" maxLength={200} className="h-9 w-56 text-sm" />
				<Button type="submit" variant="outline" disabled={isAdding}>
					{isAdding ? <Loader2 className="animate-spin" /> : "Block"}
				</Button>
			</form>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			{domains.length > 0 && (
				<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
					{domains.map(({ domain, reason }) => (
						<li key={domain} className="flex items-center gap-3 px-4 py-2.5 text-sm">
							<span className="font-mono">{domain}</span>
							<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{reason}</span>
							<Button variant="ghost" size="icon-sm" disabled={isRemoving} onClick={() => remove(domain)} aria-label={`Unblock ${domain}`} className="text-muted-foreground hover:text-destructive">
								<X />
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
