"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Reloads the page's data: for "I've added the DNS records, check again".
export default function ButtonRefresh({ children = "Check again", variant = "outline", size }) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	return (
		<Button variant={variant} size={size} disabled={isPending} onClick={() => startTransition(() => router.refresh())}>
			{isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
			{children}
		</Button>
	);
}
