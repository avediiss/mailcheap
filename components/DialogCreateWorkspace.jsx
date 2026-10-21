"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CircleAlert, Loader2, MailCheck, Plus } from "lucide-react";
import { createWorkspace } from "@/app/(app)/platform/actions";
import ButtonCopy from "@/components/ButtonCopy";
import FieldsLimits from "@/components/FieldsLimits";
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

export default function DialogCreateWorkspace({ label = "New workspace" }) {
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
					<Plus data-icon="inline-start" />
					{label}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<FormCreate key={formKey} />
			</DialogContent>
		</Dialog>
	);
}

function FormCreate() {
	const [state, action, isPending] = useActionState(createWorkspace, null);

	if (state?.ok) {
		const hasLink = Boolean(state.link);
		return (
			<>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{state.emailed ? <MailCheck className="size-5 text-emerald-600" /> : <CircleAlert className="size-5 text-amber-600" />}
						{state.name} is ready
					</DialogTitle>
					<DialogDescription>
						{state.emailed
							? "The first owner has an invitation by email. It works for 7 days."
							: state.invitationError
								? `The workspace exists, but the invitation couldn't be made: ${state.invitationError}`
								: `${state.reason} Send them this link yourself. It works for 7 days.`}
					</DialogDescription>
				</DialogHeader>
				{hasLink && (
					<div className="flex w-full min-w-0 items-center gap-1 rounded-lg bg-muted py-1 pr-1 pl-3">
						<code className="min-w-0 flex-1 truncate font-mono text-[13px]">{state.link}</code>
						<ButtonCopy value={state.link} label="Copy link" />
					</div>
				)}
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Close</Button>
					</DialogClose>
					<Button asChild>
						<Link href={`/platform/workspaces/${state.workspaceId}`}>View workspace</Link>
					</Button>
				</DialogFooter>
			</>
		);
	}

	return (
		<form action={action} className="flex flex-col gap-5">
			<DialogHeader>
				<DialogTitle>New workspace</DialogTitle>
				<DialogDescription>A space for one client or brand. Its first owner gets an invitation by email.</DialogDescription>
			</DialogHeader>
			<div className="flex flex-col gap-3">
				<Input name="name" placeholder="Workspace name, e.g. Acme Studio" required maxLength={80} autoFocus className="h-10" />
				<Input name="ownerEmail" type="email" placeholder="First owner's email" required autoComplete="off" className="h-10" />
			</div>
			<fieldset className="flex flex-col gap-3">
				<legend className="mb-1 text-sm font-medium">Limits</legend>
				<FieldsLimits />
				<p className="text-xs text-muted-foreground">Leave a field empty for no limit. You can change these any time.</p>
			</fieldset>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<DialogFooter>
				<Button type="submit" disabled={isPending} className="min-w-32">
					{isPending ? <Loader2 className="animate-spin" /> : "Create and invite"}
				</Button>
			</DialogFooter>
		</form>
	);
}
