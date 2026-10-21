"use client";

import { useState } from "react";
import { Ban, Play } from "lucide-react";
import { setWorkspaceStatus } from "@/app/(app)/platform/actions";
import DialogConfirm from "@/components/DialogConfirm";
import { Button } from "@/components/ui/button";

export default function ButtonWorkspaceStatus({ id, name, status }) {
	const [isOpen, setIsOpen] = useState(false);
	const isSuspended = status === "suspended";

	return (
		<>
			<Button variant="outline" onClick={() => setIsOpen(true)}>
				{isSuspended ? <Play data-icon="inline-start" /> : <Ban data-icon="inline-start" />}
				{isSuspended ? "Resume" : "Suspend"}
			</Button>
			<DialogConfirm
				open={isOpen}
				onOpenChange={setIsOpen}
				title={isSuspended ? `Resume ${name}?` : `Suspend ${name}?`}
				description={
					isSuspended
						? "Sending, signups and the API work again straight away."
						: "Its sending, public signups and API stop straight away, and sends under way pause. Its people can still log in and look around. You can resume it any time."
				}
				confirmLabel={isSuspended ? "Resume" : "Suspend"}
				successMessage={isSuspended ? `${name} resumed` : `${name} suspended`}
				destructive={!isSuspended}
				onConfirm={() => setWorkspaceStatus(id, isSuspended ? "active" : "suspended")}
			/>
		</>
	);
}
