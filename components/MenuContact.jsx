"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Pencil, Trash2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { setContactStatus } from "@/app/(app)/contacts/actions";
import DialogDeleteContact from "@/components/DialogDeleteContact";
import DialogEditContact from "@/components/DialogEditContact";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function MenuContact({ id, email, status, firstName, tags, fieldDefs, fieldValues }) {
	const [isPending, startTransition] = useTransition();
	const [isEditOpen, setIsEditOpen] = useState(false);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const canChangeStatus = ["active", "dormant"].includes(status);

	function update(nextStatus) {
		startTransition(async () => {
			const result = await setContactStatus(id, nextStatus);
			if (result?.error) toast.error(result.error);
		});
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${email}`} disabled={isPending}>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => setIsEditOpen(true)}>
						<Pencil />
						Edit
					</DropdownMenuItem>
					{status === "dormant" && (
						<DropdownMenuItem onSelect={() => update("active")}>
							<UserCheck />
							Reactivate
						</DropdownMenuItem>
					)}
					{canChangeStatus && (
						<DropdownMenuItem variant="destructive" onSelect={() => update("unsubscribed")}>
							<UserX />
							Unsubscribe
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onSelect={() => setIsDeleteOpen(true)}>
						<Trash2 />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{isEditOpen && (
				<DialogEditContact
					id={id}
					email={email}
					firstName={firstName}
					tags={tags}
					fieldDefs={fieldDefs}
					fieldValues={fieldValues}
					isOpen
					onOpenChange={setIsEditOpen}
				/>
			)}
			{isDeleteOpen && (
				<DialogDeleteContact id={id} email={email} status={status} isOpen onOpenChange={setIsDeleteOpen} />
			)}
		</>
	);
}
