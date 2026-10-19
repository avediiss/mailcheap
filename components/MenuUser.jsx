"use client";

import { useTransition } from "react";
import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { logout } from "@/app/(app)/actions";
import AvatarInitials from "@/components/AvatarInitials";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function MenuUser({ name, email }) {
	const [isPending, startTransition] = useTransition();
	const display = name || email;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={`Account menu for ${display}`}
					className="grid size-8 place-items-center rounded-full outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring aria-expanded:opacity-80"
				>
					<AvatarInitials name={display} size={28} />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" side="top" className="w-60">
				<DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
					{name && <span className="truncate text-sm font-medium text-foreground">{name}</span>}
					<span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/account">
						<UserRound />
						Account
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem disabled={isPending} onSelect={() => startTransition(() => logout())}>
					<LogOut />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
