"use client";

import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { removeDomain } from "@/app/(app)/domains/actions";
import DialogConfirm from "@/components/DialogConfirm";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function MenuDomain({ id, domain }) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${domain}`} className="text-muted-foreground hover:text-foreground">
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-44">
					<DropdownMenuItem variant="destructive" onSelect={() => setIsOpen(true)}>
						<Trash2 />
						Remove domain
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<DialogConfirm
				open={isOpen}
				onOpenChange={setIsOpen}
				title={`Remove ${domain}?`}
				description="You won’t be able to send from addresses on this domain. Newsletters that still use it must be changed first."
				confirmLabel="Remove"
				successMessage={`${domain} removed`}
				destructive
				onConfirm={() => removeDomain(id)}
			/>
		</>
	);
}
