"use client";

import { useTransition } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { openWorkspace } from "@/app/(app)/platform/actions";
import { Button } from "@/components/ui/button";

export default function ButtonOpenWorkspace({ id, variant = "outline", size, label = "Open" }) {
	const [isPending, startTransition] = useTransition();

	function open() {
		startTransition(async () => {
			const result = await openWorkspace(id);
			if (result?.error) toast.error(result.error);
		});
	}

	return (
		<Button variant={variant} size={size} onClick={open} disabled={isPending}>
			{isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <ArrowUpRight data-icon="inline-start" />}
			{label}
		</Button>
	);
}
