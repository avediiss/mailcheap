"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { login } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function FormLogin({ next }) {
	const [state, action, isPending] = useActionState(login, null);

	return (
		<form action={action} className="flex flex-col gap-3">
			<input type="hidden" name="next" value={next || "/"} />
			<Input
				name="email"
				type="email"
				placeholder="Email"
				autoComplete="email"
				required
				autoFocus
				className="h-10"
			/>
			<Input
				name="password"
				type="password"
				placeholder="Password"
				autoComplete="current-password"
				required
				className="h-10"
			/>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<Button type="submit" size="lg" disabled={isPending} className="mt-1">
				{isPending ? <Loader2 className="animate-spin" /> : "Continue"}
				{!isPending && <ArrowRight data-icon="inline-end" />}
			</Button>
			<Link href="/forgot-password" className="text-center text-sm text-muted-foreground hover:underline">
				Forgot your password?
			</Link>
		</form>
	);
}
