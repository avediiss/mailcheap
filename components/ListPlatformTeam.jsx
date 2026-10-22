"use client";

import { useState, useTransition } from "react";
import { Loader2, MoreHorizontal, UserMinus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { removePlatformTeamMember, revokePlatformTeamInvitation } from "@/app/(app)/platform/actions";
import AvatarInitials from "@/components/AvatarInitials";
import DialogConfirm from "@/components/DialogConfirm";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function ListPlatformTeam({ admins, invitations, currentUserId }) {
	const [removing, setRemoving] = useState(null);
	const [isPending, startTransition] = useTransition();
	const isSelf = removing?.userId === currentUserId;

	function revoke(id) {
		startTransition(async () => {
			const result = await revokePlatformTeamInvitation(id);
			if (result?.error) toast.error(result.error);
			else toast.success("Invitation revoked");
		});
	}

	return (
		<>
			<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
				{admins.map((admin) => (
					<li key={admin.userId} className="flex items-center gap-3 px-4 py-3 text-sm">
						<AvatarInitials name={admin.name || admin.email} size={32} />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="flex items-center gap-2 truncate font-medium">
								{admin.name || admin.email}
								{admin.userId === currentUserId && <span className="rounded-full px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-border">You</span>}
							</span>
							{admin.name && <span className="truncate text-xs text-muted-foreground">{admin.email}</span>}
						</span>
						<span className="hidden text-xs text-muted-foreground sm:block">{admin.lastSeen}</span>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${admin.name || admin.email}`} className="text-muted-foreground hover:text-foreground">
									<MoreHorizontal />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56">
								<DropdownMenuItem variant="destructive" onSelect={() => setRemoving(admin)}>
									<UserMinus />
									Remove administrator rights
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</li>
				))}
				{invitations.map((invitation) => (
					<li key={invitation.id} className="flex items-center gap-3 px-4 py-3 text-sm">
						<span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed text-xs text-muted-foreground">?</span>
						<span className="min-w-0 flex-1 truncate">{invitation.email}</span>
						<span className="text-xs text-muted-foreground">{invitation.isExpired ? "Invitation expired" : `Invited · until ${invitation.expires}`}</span>
						<Button variant="ghost" size="icon-sm" disabled={isPending} onClick={() => revoke(invitation.id)} aria-label={`Revoke the invitation for ${invitation.email}`} className="text-muted-foreground hover:text-destructive">
							{isPending ? <Loader2 className="animate-spin" /> : <XCircle />}
						</Button>
					</li>
				))}
			</ul>
			<DialogConfirm
				open={Boolean(removing)}
				onOpenChange={(open) => !open && setRemoving(null)}
				title={isSelf ? "Remove your own administrator rights?" : `Remove ${removing?.name || removing?.email} as administrator?`}
				description={
					isSelf
						? "You’ll lose the Platform section straight away. Your account and any workspace you belong to stay. Another administrator can give it back."
						: "They lose the Platform section straight away. Their account and any workspace they belong to stay."
				}
				confirmLabel="Remove"
				successMessage="Administrator rights removed"
				destructive
				onConfirm={() => removePlatformTeamMember(removing.userId)}
			/>
		</>
	);
}
