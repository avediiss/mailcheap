"use client";

import { useState } from "react";
import { Ban, LogOut, MailCheck, MoreHorizontal, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { sendAccountResetAction, setAccountDisabledAction, signOutAccountAction } from "@/app/(app)/platform/actions";
import AvatarInitials from "@/components/AvatarInitials";
import DialogConfirm from "@/components/DialogConfirm";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { roleLabel } from "@/lib/roles";

// Every login: who they are, where they work, when they were last here, and the few things a platform
// administrator can do to an account. Disabling signs the person out at once.
export default function ListAccounts({ accounts, currentUserId }) {
	const [disabling, setDisabling] = useState(null);

	async function run(action, successMessage) {
		const result = await action();
		if (result?.error) toast.error(result.error);
		else toast.success(successMessage);
	}

	return (
		<>
			<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
				{accounts.map((account) => (
					<li key={account.id} className="flex items-center gap-3 px-4 py-3 text-sm">
						<AvatarInitials name={account.name || account.email} size={32} />
						<span className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
								<span className="truncate">{account.name || account.email}</span>
								{account.id === currentUserId && <Pill>You</Pill>}
								{account.isPlatformAdmin && <Pill>Administrator</Pill>}
								{account.isDisabled && <Pill tone="bad">Disabled</Pill>}
							</span>
							<span className="truncate text-xs text-muted-foreground">
								{account.name ? `${account.email} · ` : ""}
								{account.memberships.length === 0
									? account.isPlatformAdmin ? "Console only, no workspace" : "No workspace"
									: account.memberships.map(({ name, role }) => `${name} (${roleLabel(role).toLowerCase()})`).join(", ")}
							</span>
						</span>
						<span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">{account.lastSeen}</span>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${account.name || account.email}`} className="text-muted-foreground hover:text-foreground">
									<MoreHorizontal />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-60">
								{!account.isDisabled && (
									<DropdownMenuItem onSelect={() => run(() => sendAccountResetAction(account.id), `Reset email sent to ${account.email}`)}>
										<MailCheck />
										Send a password reset
									</DropdownMenuItem>
								)}
								<DropdownMenuItem onSelect={() => run(() => signOutAccountAction(account.id), "Signed out everywhere")}>
									<LogOut />
									Sign out everywhere
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								{account.isDisabled ? (
									<DropdownMenuItem onSelect={() => run(() => setAccountDisabledAction(account.id, false), "Account enabled")}>
										<RotateCcw />
										Enable this account
									</DropdownMenuItem>
								) : (
									<DropdownMenuItem variant="destructive" disabled={account.id === currentUserId} onSelect={() => setDisabling(account)}>
										<Ban />
										Disable this account
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					</li>
				))}
			</ul>
			<DialogConfirm
				open={Boolean(disabling)}
				onOpenChange={(open) => !open && setDisabling(null)}
				title={`Disable ${disabling?.name || disabling?.email}?`}
				description="They’re signed out straight away and can’t log in until you enable the account again. Their data and workspaces stay as they are."
				confirmLabel="Disable"
				successMessage="Account disabled"
				destructive
				onConfirm={() => setAccountDisabledAction(disabling.id, true)}
			/>
		</>
	);
}

function Pill({ children, tone }) {
	return (
		<span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium shadow-border ${tone === "bad" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
			{children}
		</span>
	);
}
