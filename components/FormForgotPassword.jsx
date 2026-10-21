"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { forgotPassword } from "@/app/forgot-password/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function FormForgotPassword() {
	const [state, action, isPending] = useActionState(forgotPassword, null);

	if (state?.ok) {
		return (
			<div className="flex flex-col gap-4 text-center text-sm">
				<p>If that address has an account, a link is on its way. It works for an hour.</p>
				<Link href="/login" className="text-muted-foreground hover:underline">
					Back to log in
				</Link>
			</div>
		);
	}

	return (
		<form action={action} className="flex flex-col gap-3">
			<Input name="email" type="email" placeholder="Email" autoComplete="email" required autoFocus className="h-10" />
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<Button type="submit" size="lg" disabled={isPending}>
				{isPending ? <Loader2 className="animate-spin" /> : "Send the link"}
			</Button>
			<Link href="/login" className="text-center text-sm text-muted-foreground hover:underline">
				Back to log in
			</Link>
		</form>
	);
}
