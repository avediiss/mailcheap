"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addDomain } from "@/app/(app)/domains/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export default function DialogAddDomain({ label = "Add domain", variant = "default" }) {
	const [isOpen, setIsOpen] = useState(false);
	const [formKey, setFormKey] = useState(0);

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open);
				if (!open) setFormKey((key) => key + 1);
			}}
		>
			<DialogTrigger asChild>
				<Button variant={variant}>
					<Plus data-icon="inline-start" />
					{label}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<FormDomain key={formKey} onDone={() => setIsOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}

function FormDomain({ onDone }) {
	const [state, action, isPending] = useActionState(addDomain, null);

	useEffect(() => {
		if (!state?.ok) return;
		toast.success(`${state.domain} added. Add its DNS records to finish.`);
		onDone();
	}, [state, onDone]);

	return (
		<form action={action} className="flex flex-col gap-4">
			<DialogHeader>
				<DialogTitle>Add a domain</DialogTitle>
				<DialogDescription>
					The domain you send from, like example.com. You’ll get a few DNS records to add where you manage the domain.
				</DialogDescription>
			</DialogHeader>
			<Input name="domain" placeholder="example.com" autoComplete="off" autoCapitalize="none" spellCheck={false} required autoFocus className="h-10" />
			{state?.error && <p className="text-sm text-pretty text-destructive">{state.error}</p>}
			<DialogFooter>
				<Button type="submit" disabled={isPending} className="min-w-24">
					{isPending ? <Loader2 className="animate-spin" /> : "Add domain"}
				</Button>
			</DialogFooter>
		</form>
	);
}
