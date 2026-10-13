"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addContact } from "@/app/(app)/contacts/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { describeAddResult } from "@/lib/contact-add";

export default function DialogAddContact({ newsletters, defaultNewsletterId }) {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const [newsletterId, setNewsletterId] = useState(defaultNewsletterId || newsletters[0]?.id || "");
	const [email, setEmail] = useState("");
	const [firstName, setFirstName] = useState("");
	const [tags, setTags] = useState("");
	const [isAdding, startAdding] = useTransition();

	function reset() {
		setEmail("");
		setFirstName("");
		setTags("");
	}

	function onSubmit(event) {
		event.preventDefault();
		startAdding(async () => {
			const result = await addContact({ newsletterId, email, firstName, tags });
			if (result?.error) return toast.error(result.error);

			const { type, message } = describeAddResult(result);
			toast[type](message);
			if (type !== "success") return;
			reset();
			setIsOpen(false);
			router.refresh();
		});
	}

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (isAdding) return;
				setIsOpen(open);
				if (!open) reset();
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" disabled={newsletters.length === 0}>
					<Plus data-icon="inline-start" />
					Add
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add contact</DialogTitle>
					<DialogDescription>
						Add one email to a newsletter. Anyone who unsubscribed stays unsubscribed.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={onSubmit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Select value={newsletterId} onValueChange={setNewsletterId} disabled={isAdding}>
							<SelectTrigger className="h-9 w-full" aria-label="Newsletter">
								<SelectValue placeholder="Newsletter" />
							</SelectTrigger>
							<SelectContent>
								{newsletters.map((newsletter) => (
									<SelectItem key={newsletter.id} value={newsletter.id}>
										<span className="flex items-center gap-2">
											<AvatarNewsletter newsletter={newsletter} size={16} />
											{newsletter.name}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Input
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="name@example.com"
							aria-label="Email address"
							autoComplete="off"
							autoFocus
							required
							disabled={isAdding}
						/>
						<Input
							value={firstName}
							onChange={(event) => setFirstName(event.target.value)}
							placeholder="First name (optional)"
							aria-label="First name"
							maxLength={60}
							autoComplete="off"
							disabled={isAdding}
						/>
						<Input
							value={tags}
							onChange={(event) => setTags(event.target.value)}
							placeholder="Tags, separated by commas (optional)"
							aria-label="Tags"
							autoComplete="off"
							disabled={isAdding}
						/>
					</div>

					<DialogFooter>
						<Button type="submit" disabled={!newsletterId || !email.trim() || isAdding} className="min-w-24">
							{isAdding ? <Loader2 className="animate-spin" /> : "Add"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
