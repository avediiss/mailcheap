"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { setNewPassword } from "@/app/reset-password/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords-rules";

export default function FormResetPassword({ token }) {
	const [state, action, isPending] = useActionState(setNewPassword, null);

	if (state?.ok) {
		return (
			<div className="flex flex-col gap-4 text-center text-sm">
				<p>Your password is changed. You were signed out everywhere.</p>
				<Button asChild size="lg">
					<Link href="/login">Log in</Link>
				</Button>
			</div>
		);
	}
	if (!token) {
		return (
			<div className="flex flex-col gap-4 text-center text-sm">
				<p>This link isn’t valid. Ask for a new one.</p>
				<Link href="/forgot-password" className="text-muted-foreground hover:underline">
					Reset your password
				</Link>
			</div>
		);
	}

	return (
		<form action={action} className="flex flex-col gap-3">
			<input type="hidden" name="token" value={token} />
			<Input
				name="password"
				type="password"
				placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
				autoComplete="new-password"
				minLength={MIN_PASSWORD_LENGTH}
				required
				autoFocus
				className="h-10"
			/>
			<Input name="confirm" type="password" placeholder="Repeat it" autoComplete="new-password" required className="h-10" />
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<Button type="submit" size="lg" disabled={isPending}>
				{isPending ? <Loader2 className="animate-spin" /> : "Save the new password"}
			</Button>
		</form>
	);
}
