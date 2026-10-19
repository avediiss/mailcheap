"use client";

import { useState, useTransition } from "react";
import { Link2, Loader2, MailPlus, MoreHorizontal, XCircle } from "lucide-react";
import { toast } from "sonner";
import { getInvitationLink, resendInvitation, revokeWorkspaceInvitation } from "@/app/(app)/members/actions";
import DialogConfirm from "@/components/DialogConfirm";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { roleLabel } from "@/lib/invitation-rules";

export default function ListInvitations({ invitations, canManage }) {
	const [revoking, setRevoking] = useState(null);
	const [isPending, startTransition] = useTransition();

	function resend(invitation) {
		startTransition(async () => {
			const result = await resendInvitation(invitation.id);
			if (result?.error) toast.error(result.error);
			else if (result.emailed) toast.success(`Invitation sent again to ${invitation.email}`);
			else toast.error(result.reason);
		});
	}

	function copyLink(invitation) {
		startTransition(async () => {
			const result = await getInvitationLink(invitation.id);
			if (result?.error) return void toast.error(result.error);
			try {
				await navigator.clipboard.writeText(result.link);
				toast.success("New link copied. The previous one no longer works.");
			} catch {
				toast.error("Couldn't copy the link");
			}
		});
	}

	return (
		<>
			<div className="overflow-hidden rounded-xl shadow-border animate-enter">
				<Table>
					<TableHeader>
						<TableRow className="hover:bg-transparent">
							<TableHead className="pl-4">Email</TableHead>
							<TableHead className="w-36">Role</TableHead>
							<TableHead className="hidden sm:table-cell">Expires</TableHead>
							{canManage && <TableHead className="w-12 pr-2" />}
						</TableRow>
					</TableHeader>
					<TableBody>
						{invitations.map((invitation) => (
							<TableRow key={invitation.id}>
								<TableCell className="py-3 pl-4 font-medium">{invitation.email}</TableCell>
								<TableCell className="text-sm">{roleLabel(invitation.role)}</TableCell>
								<TableCell className="hidden text-muted-foreground sm:table-cell">
									{invitation.isExpired ? <span className="text-amber-600 dark:text-amber-400">Expired</span> : invitation.expires}
								</TableCell>
								{canManage && (
									<TableCell className="pr-2 text-right">
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon-sm" disabled={isPending} aria-label={`Actions for ${invitation.email}`} className="text-muted-foreground hover:text-foreground">
													{isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end" className="w-48">
												<DropdownMenuItem onSelect={() => resend(invitation)}>
													<MailPlus />
													Send again
												</DropdownMenuItem>
												<DropdownMenuItem onSelect={() => copyLink(invitation)}>
													<Link2 />
													Copy new link
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem variant="destructive" onSelect={() => setRevoking(invitation)}>
													<XCircle />
													Revoke
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
				open={Boolean(revoking)}
				onOpenChange={(open) => !open && setRevoking(null)}
				title={`Revoke the invitation for ${revoking?.email}?`}
				description="The link stops working. You can invite them again later."
				confirmLabel="Revoke"
				successMessage="Invitation revoked"
				destructive
				onConfirm={() => revokeWorkspaceInvitation(revoking.id)}
			/>
		</>
	);
}
