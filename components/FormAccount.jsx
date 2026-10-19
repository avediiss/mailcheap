"use client";

import { useActionState, useEffect, useTransition } from "react";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { changePassword, signOutEverywhere, updateProfile } from "@/app/(app)/account/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords-rules";

function useToastOnSuccess(state, message) {
	useEffect(() => {
		if (state?.ok) toast.success(message);
	}, [state, message]);
}

export function FormProfile({ name, email }) {
	const [state, action, isPending] = useActionState(updateProfile, null);
	useToastOnSuccess(state, "Saved");

	return (
		<form action={action} className="flex flex-col gap-4 p-4 sm:p-5">
			<Field label="Name" hint="Shown to the people you work with.">
				<Input name="name" defaultValue={name} maxLength={120} autoComplete="name" placeholder="Your name" />
			</Field>
			<Field label="Email" hint="You log in with this address. To change it, ask the platform owner.">
				<Input value={email} readOnly disabled />
			</Field>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<div>
				<Button type="submit" disabled={isPending} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Save"}
				</Button>
			</div>
		</form>
	);
}

export function FormPassword() {
	const [state, action, isPending] = useActionState(changePassword, null);
	useToastOnSuccess(state, "Password changed. Your other devices were signed out.");

	return (
		// A new key after success clears the fields.
		<form key={state?.ok ? "done" : "form"} action={action} className="flex flex-col gap-4 p-4 sm:p-5">
			<Field label="Current password">
				<Input name="current" type="password" autoComplete="current-password" required />
			</Field>
			<Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few random words work well.`}>
				<Input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
			</Field>
			<Field label="Repeat the new password">
				<Input name="confirm" type="password" autoComplete="new-password" required />
			</Field>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<div>
				<Button type="submit" disabled={isPending} className="min-w-36">
					{isPending ? <Loader2 className="animate-spin" /> : "Change password"}
				</Button>
			</div>
		</form>
	);
}

export function ButtonSignOutEverywhere() {
	const [isPending, startTransition] = useTransition();

	return (
		<Button variant="outline" disabled={isPending} onClick={() => startTransition(() => signOutEverywhere())}>
			{isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <LogOut data-icon="inline-start" />}
			Sign out everywhere
		</Button>
	);
}

function Field({ label, hint, children }) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-sm font-medium">{label}</span>
			{children}
			{hint && <span className="text-xs text-pretty text-muted-foreground">{hint}</span>}
		</label>
	);
}
