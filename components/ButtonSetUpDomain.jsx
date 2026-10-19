"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setUpDomain } from "@/app/(app)/domains/actions";
import { Button } from "@/components/ui/button";

export default function ButtonSetUpDomain({ id }) {
	const [isPending, startTransition] = useTransition();

	function setUp() {
		startTransition(async () => {
			const result = await setUpDomain(id);
			if (result?.error) toast.error(result.error);
			else toast.success("Set up. Add its DNS records to finish.");
		});
	}

	return (
		<Button size="sm" onClick={setUp} disabled={isPending}>
			{isPending ? <Loader2 className="animate-spin" /> : "Set up"}
		</Button>
	);
}
