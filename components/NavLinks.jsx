"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Building2, Globe, KeyRound, LayoutGrid, Newspaper, Send, ShieldCheck, UserCog, Users } from "lucide-react";
import { hasRole } from "@/lib/workspace-rules";
import { cn } from "@/lib/utils";

export default function NavLinks({ onNavigate, role, isPlatformAdmin = false, showWorkspace = true }) {
	const pathname = usePathname();

	const items = showWorkspace ? NAV_ITEMS.filter(({ requires }) => !requires || hasRole(role, requires)) : [];

	return (
		<nav className="flex flex-col gap-0.5">
			{items.map((item) => (
				<NavItem key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
			))}
			{isPlatformAdmin && (
				<>
					<span className={`${showWorkspace ? "mt-4" : ""} mb-1 px-2.5 text-xs font-medium text-muted-foreground/70`}>Platform</span>
					{PLATFORM_ITEMS.map((item) => (
						<NavItem key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
					))}
				</>
			)}
		</nav>
	);
}

function NavItem({ item: { href, label, icon: Icon, exact }, pathname, onNavigate }) {
	const isActive = href === "/" || exact ? pathname === href : pathname.startsWith(href);
	return (
		<Link
			href={href}
			onClick={onNavigate}
			aria-current={isActive ? "page" : undefined}
			className={cn(
				"flex h-9 items-center gap-2.5 rounded-lg pr-3 pl-2.5 text-sm font-medium transition-colors duration-150",
				isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
			)}
		>
			<Icon className="size-4" />
			{label}
		</Link>
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

// The platform owner's own pages, apart from any one workspace.
const PLATFORM_ITEMS = [
	{ href: "/platform", label: "Overview", icon: ShieldCheck, exact: true },
	{ href: "/platform/workspaces", label: "Workspaces", icon: Building2 },
	{ href: "/platform/accounts", label: "Accounts", icon: Users },
	{ href: "/platform/domains", label: "Domains", icon: Globe },
	{ href: "/platform/activity", label: "Activity", icon: Activity },
	{ href: "/platform/team", label: "Team", icon: UserCog },
];
