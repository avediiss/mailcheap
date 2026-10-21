"use client";

import { useActionState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateWorkspace } from "@/app/(app)/platform/actions";
import FieldsLimits from "@/components/FieldsLimits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function FormWorkspaceSettings({ id, name, limits }) {
	const [state, action, isPending] = useActionState(updateWorkspace, null);

	useEffect(() => {
		if (state?.ok) toast.success("Saved");
	}, [state]);

	return (
		<form action={action} className="flex flex-col gap-4 p-4 sm:p-5">
			<input type="hidden" name="id" value={id} />
			<label className="grid gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center sm:gap-4">
				<span className="text-sm font-medium">Name</span>
				<Input name="name" defaultValue={name} required maxLength={80} />
			</label>
			<FieldsLimits values={limits} />
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<div>
				<Button type="submit" disabled={isPending} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Save"}
				</Button>
			</div>
		</form>
	);
}
