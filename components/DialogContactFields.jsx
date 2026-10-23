"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Braces, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createContactField, removeContactField } from "@/app/(app)/contacts/actions";
import DialogConfirm from "@/components/DialogConfirm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MAX_FIELDS_PER_WORKSPACE } from "@/lib/contact-fields";

const TYPE_LABELS = { text: "Text", number: "Number", date: "Date" };

// The workspace's custom contact fields: what exists, add one, remove one. Each prints in emails as {{key}}.
export default function DialogContactFields({ fields }) {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const [label, setLabel] = useState("");
	const [type, setType] = useState("text");
	const [removing, setRemoving] = useState(null);
	const [isAdding, startAdding] = useTransition();

	function add(event) {
		event.preventDefault();
		startAdding(async () => {
			const result = await createContactField({ label, type });
			if (result?.error) return void toast.error(result.error);
			toast.success(`Field added: use {{${result.field.key}}} in an email`);
			setLabel("");
			router.refresh();
		});
	}

	return (
		<>
			<Dialog open={isOpen} onOpenChange={setIsOpen}>
				<DialogTrigger asChild>
					<Button variant="outline">
						<Braces data-icon="inline-start" />
						Fields
					</Button>
				</DialogTrigger>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Contact fields</DialogTitle>
						<DialogDescription>
							Extra details you keep about each contact, like a plan or a renewal date. Put one in an email with its tag, and add a fallback after a bar:
							{" "}
							<code className="rounded bg-muted px-1 py-0.5 text-xs">{"{{plan|your plan}}"}</code>
						</DialogDescription>
					</DialogHeader>
					{fields.length > 0 && (
						<ul className="divide-y divide-border/60 overflow-hidden rounded-lg shadow-border">
							{fields.map((field) => (
								<li key={field.key} className="flex items-center gap-3 px-3 py-2 text-sm">
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate font-medium">{field.label}</span>
										<span className="truncate font-mono text-xs text-muted-foreground">{`{{${field.key}}}`} · {TYPE_LABELS[field.type]}</span>
									</span>
									<Button variant="ghost" size="icon-sm" onClick={() => setRemoving(field)} aria-label={`Remove ${field.label}`} className="text-muted-foreground hover:text-destructive">
										<Trash2 />
									</Button>
								</li>
							))}
						</ul>
					)}
					{fields.length < MAX_FIELDS_PER_WORKSPACE && (
						<form onSubmit={add} className="flex flex-wrap gap-2">
							<Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Field name, like Plan" maxLength={40} required className="h-9 min-w-40 flex-1" disabled={isAdding} />
							<select
								value={type}
								onChange={(event) => setType(event.target.value)}
								aria-label="Type"
								disabled={isAdding}
								className="h-9 rounded-lg bg-card px-2.5 text-sm shadow-border outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
							>
								{Object.entries(TYPE_LABELS).map(([value, name]) => (
									<option key={value} value={value}>
										{name}
									</option>
								))}
							</select>
							<Button type="submit" disabled={isAdding || !label.trim()} className="min-w-16">
								{isAdding ? <Loader2 className="animate-spin" /> : "Add"}
							</Button>
						</form>
					)}
				</DialogContent>
			</Dialog>
			<DialogConfirm
				open={Boolean(removing)}
				onOpenChange={(open) => !open && setRemoving(null)}
				title={`Remove ${removing?.label}?`}
				description="Its value is removed from every contact. An email that still has its tag prints the fallback after the bar, or nothing."
				confirmLabel="Remove"
				successMessage="Field removed"
				destructive
				onConfirm={async () => {
					const result = await removeContactField(removing.key);
					if (!result?.error) router.refresh();
					return result;
				}}
			/>
		</>
	);
}
