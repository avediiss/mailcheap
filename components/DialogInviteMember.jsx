"use client";

import { useActionState, useState } from "react";
import { CircleAlert, Loader2, MailCheck, UserPlus } from "lucide-react";
import { inviteToWorkspace } from "@/app/(app)/members/actions";
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
import { describeRole, roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

export default function DialogInviteMember() {
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
					Invite
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<FormInvite key={formKey} />
			</DialogContent>
		</Dialog>
	);
}

function FormInvite() {
	const [state, action, isPending] = useActionState(inviteToWorkspace, null);
	const [role, setRole] = useState("editor");

	if (state?.ok) {
		return (
			<>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{state.emailed ? <MailCheck className="size-5 text-emerald-600" /> : <CircleAlert className="size-5 text-amber-600" />}
						{state.emailed ? "Invitation sent" : "Invitation created"}
					</DialogTitle>
					<DialogDescription>
						{state.emailed
							? "They'll get an email with a link that works for 7 days."
							: `${state.reason} Share this link with them instead. It works for 7 days.`}
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
		<form action={action} className="flex flex-col gap-5">
			<DialogHeader>
				<DialogTitle>Invite someone</DialogTitle>
				<DialogDescription>They’ll get an email to join this workspace.</DialogDescription>
			</DialogHeader>
			<Input name="email" type="email" placeholder="Email address" autoComplete="off" required autoFocus className="h-10" />
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-2 text-sm font-medium">Role</legend>
				<input type="hidden" name="role" value={role} />
				{["editor", "owner"].map((value) => (
					<button
						key={value}
						type="button"
						role="radio"
						aria-checked={role === value}
						onClick={() => setRole(value)}
						className={cn(
							"flex items-start gap-3 rounded-lg px-3 py-2.5 text-left shadow-border outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
							role === value ? "bg-muted" : "hover:bg-muted/50"
						)}
					>
						<span className={cn("mt-1 grid size-4 shrink-0 place-items-center rounded-full border", role === value ? "border-foreground" : "border-muted-foreground/50")}>
							{role === value && <span className="size-2 rounded-full bg-foreground" />}
						</span>
						<span className="flex flex-col gap-0.5">
							<span className="text-sm font-medium">{roleLabel(value)}</span>
							<span className="text-xs text-pretty text-muted-foreground">{describeRole(value)}</span>
						</span>
					</button>
				))}
			</fieldset>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<DialogFooter>
				<Button type="submit" disabled={isPending} className="min-w-28">
					{isPending ? <Loader2 className="animate-spin" /> : "Send invitation"}
				</Button>
			</DialogFooter>
		</form>
	);
}
