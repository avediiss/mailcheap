"use client";

import { useActionState, useState } from "react";
import { CircleAlert, Loader2, MailCheck, UserPlus } from "lucide-react";
import { invitePlatformTeamMember } from "@/app/(app)/platform/actions";
import ButtonCopy from "@/components/ButtonCopy";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export default function DialogInvitePlatformAdmin() {
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
				<Button>
					<UserPlus data-icon="inline-start" />
					Invite administrator
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<Form key={formKey} />
			</DialogContent>
		</Dialog>
	);
}

function Form() {
	const [state, action, isPending] = useActionState(invitePlatformTeamMember, null);

	if (state?.ok) {
		return (
			<>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{state.emailed ? <MailCheck className="size-5 text-emerald-600" /> : <CircleAlert className="size-5 text-amber-600" />}
						{state.emailed ? "Invitation sent" : "Invitation created"}
					</DialogTitle>
					<DialogDescription>
						{state.emailed ? "They’ll get an email with a link that works for 7 days." : `${state.reason} Send them this link yourself. It works for 7 days.`}
					</DialogDescription>
				</DialogHeader>
				<div className="flex w-full min-w-0 items-center gap-1 rounded-lg bg-muted py-1 pr-1 pl-3">
					<code className="min-w-0 flex-1 truncate font-mono text-[13px]">{state.link}</code>
					<ButtonCopy value={state.link} label="Copy link" />
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button>Done</Button>
					</DialogClose>
				</DialogFooter>
			</>
		);
	}

	return (
		<form action={action} className="flex flex-col gap-4">
			<DialogHeader>
				<DialogTitle>Invite an administrator</DialogTitle>
				<DialogDescription>
					They run the platform from the console: clients, limits and health. The account has no workspace of its own, so it can’t see any client’s contacts or campaigns.
				</DialogDescription>
			</DialogHeader>
			<Input name="email" type="email" placeholder="Email address" autoComplete="off" required autoFocus className="h-10" />
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<DialogFooter>
				<Button type="submit" disabled={isPending} className="min-w-32">
					{isPending ? <Loader2 className="animate-spin" /> : "Send invitation"}
				</Button>
			</DialogFooter>
		</form>
	);
}
