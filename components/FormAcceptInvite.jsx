"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { acceptInvitation, joinWorkspace } from "@/app/invite/[token]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords-rules";

// A new person: the invitation's address is fixed, they choose a name and a password.
export function FormAcceptInvite({ token, email }) {
	const [state, action, isPending] = useActionState(acceptInvitation, null);

	return (
		<form action={action} className="flex flex-col gap-3">
			<input type="hidden" name="token" value={token} />
			<Input value={email} readOnly disabled className="h-10" aria-label="Email" />
			<Input name="name" placeholder="Your name" autoComplete="name" maxLength={120} autoFocus className="h-10" />
			<Input
				name="password"
				type="password"
				placeholder={`Choose a password (${MIN_PASSWORD_LENGTH}+ characters)`}
				autoComplete="new-password"
				minLength={MIN_PASSWORD_LENGTH}
				required
				className="h-10"
			/>
			<Input name="confirm" type="password" placeholder="Repeat it" autoComplete="new-password" required className="h-10" />
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<Button type="submit" size="lg" disabled={isPending}>
				{isPending ? <Loader2 className="animate-spin" /> : "Join and continue"}
			</Button>
		</form>
	);
}

// Someone who already has an account and is logged in as the invited address.
export function FormJoinWorkspace({ token, workspaceName }) {
	const [state, action, isPending] = useActionState(joinWorkspace, null);

	return (
		<form action={action} className="flex flex-col gap-3">
			<input type="hidden" name="token" value={token} />
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<Button type="submit" size="lg" disabled={isPending}>
				{isPending ? <Loader2 className="animate-spin" /> : `Join ${workspaceName}`}
			</Button>
		</form>
	);
}
