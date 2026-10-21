"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe, KeyRound, LayoutGrid, Newspaper, Send, UserCog, Users } from "lucide-react";
import { hasRole } from "@/lib/workspace-rules";
import { cn } from "@/lib/utils";

export default function NavLinks({ onNavigate, role }) {
	const pathname = usePathname();

	return (
		<nav className="flex flex-col gap-0.5">
			{NAV_ITEMS.filter(({ requires }) => !requires || hasRole(role, requires)).map(({ href, label, icon: Icon }) => {
				const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
				return (
					<Link
						key={href}
						href={href}
						onClick={onNavigate}
						aria-current={isActive ? "page" : undefined}
						className={cn(
							"flex h-9 items-center gap-2.5 rounded-lg pr-3 pl-2.5 text-sm font-medium transition-colors duration-150",
							isActive
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
						)}
					>
						<Icon className="size-4" />
						{label}
					</Link>
				);
			})}
		</nav>
	);
}

const NAV_ITEMS = [
	{ href: "/", label: "Overview", icon: LayoutGrid },
	{ href: "/campaigns", label: "Campaigns", icon: Send },
	{ href: "/contacts", label: "Contacts", icon: Users },
	{ href: "/newsletters", label: "Newsletters", icon: Newspaper },
	{ href: "/domains", label: "Domains", icon: Globe },
	{ href: "/members", label: "Members", icon: UserCog },
	// Keys reach everything in the workspace, so only its owners see them.
	{ href: "/api-keys", label: "API keys", icon: KeyRound, requires: "owner" },
];
