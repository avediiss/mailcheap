"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { readSite } from "@/app/(app)/gtm/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Step 1. Paste the product's address; the server reads the page and its pricing page. A site built in
// JavaScript has nothing to read, so it comes back asking for a description instead of guessing.
export default function FormGtmUrl({ product, onDone }) {
	const router = useRouter();
	const [url, setUrl] = useState(product?.url ?? "");
	const [description, setDescription] = useState("");
	const [needsDescription, setNeedsDescription] = useState(Boolean(product?.needsDescription));
	const [isReading, startReading] = useTransition();

	function onSubmit(event) {
		event.preventDefault();
		startReading(async () => {
			const result = await readSite({ url, pastedDescription: description });
			if (result?.error) return toast.error(result.error);

			if (result?.needsDescription) {
				setNeedsDescription(true);
				toast.message("There was almost nothing to read on that page", {
					description: "Describe your product in a sentence or two and we'll work from that.",
				});
				return;
			}
			toast.success("Read your site");
			router.refresh();
			onDone();
		});
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-6 animate-enter">
			<div className="flex flex-col gap-2">
				<Label htmlFor="gtm-url">Your product&apos;s web address</Label>
				<Input
					id="gtm-url"
					name="url"
					type="text"
					inputMode="url"
					autoComplete="url"
					placeholder="acme.com"
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					disabled={isReading}
					required
				/>
				<p className="text-xs text-muted-foreground">
					We read the page and its pricing page, then draft a profile you can correct.
				</p>
			</div>

			{needsDescription && (
				<div className="flex flex-col gap-2">
					<Label htmlFor="gtm-description">What does it do?</Label>
					<Textarea
						id="gtm-description"
						name="description"
						rows={4}
						placeholder="Invoicing for freelance designers that chases late payers for you."
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						disabled={isReading}
						required
					/>
					<p className="text-xs text-muted-foreground">
						That page is built in the browser, so there was no text in it to read. A sentence or two is plenty.
					</p>
				</div>
			)}

			<div>
				<Button type="submit" disabled={isReading || !url.trim()}>
					{isReading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Globe data-icon="inline-start" />}
					{isReading ? "Reading your site…" : "Read my site"}
				</Button>
			</div>
		</form>
	);
}
