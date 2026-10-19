"use client";

import { useState, useTransition } from "react";
import { Loader2, MoreHorizontal, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { removeWorkspaceMember, setMemberRole } from "@/app/(app)/members/actions";
import AvatarInitials from "@/components/AvatarInitials";
import DialogConfirm from "@/components/DialogConfirm";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { roleLabel } from "@/lib/invitation-rules";

export default function ListMembers({ members, currentUserId, canManage }) {
	const [removing, setRemoving] = useState(null);
	const isSelf = removing?.userId === currentUserId;

	return (
		<>
			<div className="overflow-hidden rounded-xl shadow-border animate-enter">
				<Table>
					<TableHeader>
						<TableRow className="hover:bg-transparent">
							<TableHead className="pl-4">Person</TableHead>
							<TableHead className="w-36">Role</TableHead>
							<TableHead className="hidden sm:table-cell">Last seen</TableHead>
							{canManage && <TableHead className="w-12 pr-2" />}
						</TableRow>
					</TableHeader>
					<TableBody>
						{members.map((member) => (
							<TableRow key={member.userId}>
								<TableCell className="py-3 pl-4">
									<div className="flex min-w-0 items-center gap-3">
										<AvatarInitials name={member.name || member.email} size={32} />
										<div className="flex min-w-0 flex-col">
											<span className="flex items-center gap-2 truncate font-medium">
												{member.name || member.email}
												{member.userId === currentUserId && (
													<span className="rounded-full px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-border">You</span>
												)}
											</span>
											{member.name && <span className="truncate text-xs text-muted-foreground">{member.email}</span>}
										</div>
									</div>
								</TableCell>
								<TableCell>
									{canManage ? <SelectRole member={member} /> : <span className="text-sm">{roleLabel(member.role)}</span>}
								</TableCell>
								<TableCell className="hidden text-muted-foreground sm:table-cell">{member.lastSeen}</TableCell>
								{canManage && (
									<TableCell className="pr-2 text-right">
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.name || member.email}`} className="text-muted-foreground hover:text-foreground">
													<MoreHorizontal />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end" className="w-44">
												<DropdownMenuItem variant="destructive" onSelect={() => setRemoving(member)}>
													<UserMinus />
													{member.userId === currentUserId ? "Leave workspace" : "Remove"}
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								)}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<DialogConfirm
				open={Boolean(removing)}
				onOpenChange={(open) => !open && setRemoving(null)}
				title={isSelf ? "Leave this workspace?" : `Remove ${removing?.name || removing?.email}?`}
				description={
					isSelf
						? "You'll lose access to its newsletters, contacts and campaigns. Another owner would have to invite you back."
						: "They'll lose access to this workspace straight away. Their account stays, and they can be invited again."
				}
				confirmLabel={isSelf ? "Leave" : "Remove"}
				successMessage="Removed"
				destructive
				onConfirm={() => removeWorkspaceMember(removing.userId)}
			/>
		</>
	);
}

function SelectRole({ member }) {
	const [isPending, startTransition] = useTransition();

	function change(role) {
		startTransition(async () => {
			const result = await setMemberRole(member.userId, role);
			if (result?.error) toast.error(result.error);
			else toast.success(`${member.name || member.email} is now ${role === "owner" ? "an owner" : "an editor"}`);
		});
	}

	return (
		<span className="inline-flex items-center gap-2">
			<Select value={member.role} onValueChange={change} disabled={isPending}>
				<SelectTrigger size="sm" className="w-28" aria-label={`Role of ${member.name || member.email}`}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="owner">Owner</SelectItem>
					<SelectItem value="editor">Editor</SelectItem>
				</SelectContent>
			</Select>
			{isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
		</span>
	);
}
