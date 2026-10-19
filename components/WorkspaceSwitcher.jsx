"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { switchWorkspace } from "@/app/(app)/workspaces/actions";
import AvatarInitials from "@/components/AvatarInitials";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabel } from "@/lib/roles";

// Shows which workspace you're working in. With several, it's a menu to move between them; with one it
// is only a label, since there's nothing to choose.
export default function WorkspaceSwitcher({ workspaces, currentId, isPlatformAdmin }) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const current = workspaces.find(({ id }) => id === currentId) ?? workspaces[0];
	if (!current) return null;

	const subtitle = isPlatformAdmin ? "Platform owner" : roleLabel(current.role);
	const label = (
		<>
			<AvatarInitials name={current.name} size={28} shape="square" />
			<span className="flex min-w-0 flex-1 flex-col text-left">
				<span className="truncate text-sm leading-tight font-medium">{current.name}</span>
				<span className="truncate text-xs leading-tight text-muted-foreground">
					{current.status === "suspended" ? "Suspended" : subtitle}
				</span>
			</span>
		</>
	);

	if (workspaces.length < 2) {
		return <div className="flex h-11 items-center gap-2.5 rounded-lg px-2 shadow-border">{label}</div>;
	}

	function pick(id) {
		if (id === currentId) return;
		startTransition(async () => {
			const result = await switchWorkspace(id);
			if (result?.error) return void toast.error(result.error);
			router.push("/");
			router.refresh();
		});
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={`Workspace: ${current.name}. Switch workspace`}
					className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2 shadow-border outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted/50"
				>
					{label}
					{isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <ChevronsUpDown className="size-4 text-muted-foreground" />}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
				<DropdownMenuLabel>Workspaces</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={current.id} onValueChange={pick}>
					{workspaces.map((workspace) => (
						<DropdownMenuRadioItem key={workspace.id} value={workspace.id} className="gap-2.5">
							<AvatarInitials name={workspace.name} size={20} shape="square" />
							<span className="min-w-0 flex-1 truncate">{workspace.name}</span>
							{workspace.status === "suspended" && <span className="text-xs text-muted-foreground">Suspended</span>}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
