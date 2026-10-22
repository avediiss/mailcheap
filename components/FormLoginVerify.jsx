"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { verifyLogin } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function FormLoginVerify() {
	const [state, action, isPending] = useActionState(verifyLogin, null);
	const [isRecovery, setIsRecovery] = useState(false);

	return (
		<form action={action} className="flex flex-col gap-3">
			<Input
				key={isRecovery ? "recovery" : "code"}
				name="code"
				type="text"
				inputMode={isRecovery ? "text" : "numeric"}
				autoComplete="one-time-code"
				placeholder={isRecovery ? "xxxx-xxxx-xxxx-xxxx" : "123 456"}
				aria-label={isRecovery ? "Recovery code" : "Authenticator code"}
				required
				autoFocus
				spellCheck={false}
				autoCapitalize="none"
				className="h-10 text-center font-mono tracking-widest"
			/>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<Button type="submit" size="lg" disabled={isPending} className="mt-1">
				{isPending ? <Loader2 className="animate-spin" /> : "Log in"}
				{!isPending && <ArrowRight data-icon="inline-end" />}
			</Button>
			<button type="button" onClick={() => setIsRecovery((value) => !value)} className="text-center text-sm text-muted-foreground hover:underline">
				{isRecovery ? "Use my authenticator app" : "Lost your phone? Use a recovery code"}
			</button>
			{state?.expired && (
				<Link href="/login" className="text-center text-sm underline underline-offset-2">
					Back to log in
				</Link>
			)}
		</form>
	);
}
