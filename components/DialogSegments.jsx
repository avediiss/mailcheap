"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { countSegmentRules, removeSegment, saveSegment } from "@/app/(app)/contacts/actions";
import DialogConfirm from "@/components/DialogConfirm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { MAX_CONDITIONS, MAX_SEGMENTS_PER_NEWSLETTER, OP_LABELS, getSegmentFields, valueKindOf } from "@/lib/segments";

const selectClass = "h-9 rounded-lg bg-card px-2.5 text-sm shadow-border outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
const blankRule = { field: "tag", op: "has", value: "" };

// A newsletter's saved segments: the list, and a builder for the rules. A segment is worked out each time it is used,
// so people join and leave it on their own.
export default function DialogSegments({ newsletterId, segments, fieldDefs }) {
	const router = useRouter();
	const fields = getSegmentFields(fieldDefs);
	const [isOpen, setIsOpen] = useState(false);
	const [draft, setDraft] = useState(null);
	const [removing, setRemoving] = useState(null);
	const [count, setCount] = useState(null);
	const [isWorking, startWorking] = useTransition();

	function startNew() {
		setCount(null);
		setDraft({ name: "", match: "all", conditions: [{ ...blankRule }] });
	}

	function startEdit(segment) {
		setCount(null);
		setDraft({ id: segment.id, name: segment.name, match: segment.match, conditions: segment.conditions.map((condition) => ({ value: "", ...condition })) });
	}

	function change(index, changes) {
		setCount(null);
		setDraft((current) => ({
			...current,
			conditions: current.conditions.map((condition, position) => {
				if (position !== index) return condition;
				const next = { ...condition, ...changes };
				// A new field starts on its first op; a new op forgets a value of the wrong kind.
				if (changes.field) next.op = fields[changes.field].ops[0];
				if (changes.field || changes.op) next.value = "";
				return next;
			}),
		}));
	}

	function payload() {
		return { ...draft, newsletterId };
	}

	function preview() {
		startWorking(async () => {
			const result = await countSegmentRules(payload());
			if (result?.error) return void toast.error(result.error);
			setCount(result.count);
		});
	}

	function save() {
		startWorking(async () => {
			const result = await saveSegment(payload());
			if (result?.error) return void toast.error(result.error);
			toast.success("Segment saved");
			setDraft(null);
			router.refresh();
		});
	}

	return (
		<>
			<Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setDraft(null); }}>
				<DialogTrigger asChild>
					<Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground">
						<Plus className="size-3.5" />
						{segments.length === 0 ? "Create a segment" : "Manage"}
					</Button>
				</DialogTrigger>
				<DialogContent className="sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>{draft ? (draft.id ? "Edit segment" : "New segment") : "Segments"}</DialogTitle>
						<DialogDescription>
							{draft
								? "People who match are found each time you use it, so it stays up to date by itself."
								: "A saved group of people picked by rules. Choose one when you send an issue, or filter the list by it."}
						</DialogDescription>
					</DialogHeader>

					{!draft && (
						<>
							{segments.length > 0 && (
								<ul className="divide-y divide-border/60 overflow-hidden rounded-lg shadow-border">
									{segments.map((segment) => (
										<li key={segment.id} className="flex items-center gap-2 px-3 py-2 text-sm">
											<span className="min-w-0 flex-1 truncate font-medium">{segment.name}</span>
											<span className="text-xs text-muted-foreground tabular-nums">{formatNumber(segment.count)} people</span>
											<Button variant="ghost" size="icon-sm" onClick={() => startEdit(segment)} aria-label={`Edit ${segment.name}`}>
												<Pencil />
											</Button>
											<Button variant="ghost" size="icon-sm" onClick={() => setRemoving(segment)} aria-label={`Delete ${segment.name}`} className="text-muted-foreground hover:text-destructive">
												<Trash2 />
											</Button>
										</li>
									))}
								</ul>
							)}
							<div>
								<Button onClick={startNew} disabled={segments.length >= MAX_SEGMENTS_PER_NEWSLETTER}>
									<Plus data-icon="inline-start" />
									New segment
								</Button>
							</div>
						</>
					)}

					{draft && (
						<div className="flex flex-col gap-4">
							<Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Name, like Engaged VIPs" maxLength={60} aria-label="Segment name" autoFocus />
							<div className="flex items-center gap-2 text-sm">
								People who match
								<select value={draft.match} onChange={(event) => { setCount(null); setDraft({ ...draft, match: event.target.value }); }} aria-label="Match" className={selectClass}>
									<option value="all">all</option>
									<option value="any">any</option>
								</select>
								of these rules
							</div>
							<ul className="flex flex-col gap-2">
								{draft.conditions.map((condition, index) => {
									const spec = fields[condition.field];
									const kind = valueKindOf(condition.op);
									return (
										<li key={index} className="flex flex-wrap items-center gap-2">
											<select value={condition.field} onChange={(event) => change(index, { field: event.target.value })} aria-label="What to look at" className={`${selectClass} w-44`}>
												{Object.entries(fields).map(([key, { label }]) => (
													<option key={key} value={key}>
														{label}
													</option>
												))}
											</select>
											<select value={condition.op} onChange={(event) => change(index, { op: event.target.value })} aria-label="Condition" className={`${selectClass} w-40`}>
												{(spec?.ops ?? []).map((op) => (
													<option key={op} value={op}>
														{OP_LABELS[op]}
													</option>
												))}
											</select>
											{kind !== "none" && (
												<Input
													type={kind === "date" ? "date" : "text"}
													inputMode={kind === "days" || kind === "number" ? "decimal" : undefined}
													value={condition.value ?? ""}
													onChange={(event) => change(index, { value: event.target.value })}
													aria-label="Value"
													className="h-9 min-w-24 flex-1"
												/>
											)}
											<Button variant="ghost" size="icon-sm" disabled={draft.conditions.length === 1} onClick={() => { setCount(null); setDraft({ ...draft, conditions: draft.conditions.filter((_, position) => position !== index) }); }} aria-label="Remove this rule">
												<X />
											</Button>
										</li>
									);
								})}
							</ul>
							{draft.conditions.length < MAX_CONDITIONS && (
								<div>
									<Button variant="outline" size="sm" onClick={() => { setCount(null); setDraft({ ...draft, conditions: [...draft.conditions, { ...blankRule }] }); }}>
										<Plus data-icon="inline-start" />
										Add a rule
									</Button>
								</div>
							)}
							<DialogFooter className="items-center sm:justify-between">
								<span className="text-sm text-muted-foreground tabular-nums">{count === null ? "" : `${formatNumber(count)} ${count === 1 ? "person matches" : "people match"} now`}</span>
								<div className="flex gap-2">
									<Button variant="ghost" onClick={() => setDraft(null)} disabled={isWorking}>
										Back
									</Button>
									<Button variant="outline" onClick={preview} disabled={isWorking}>
										Count
									</Button>
									<Button onClick={save} disabled={isWorking || !draft.name.trim()} className="min-w-16">
										{isWorking ? <Loader2 className="animate-spin" /> : "Save"}
									</Button>
								</div>
							</DialogFooter>
						</div>
					)}
				</DialogContent>
			</Dialog>
			<DialogConfirm
				open={Boolean(removing)}
				onOpenChange={(open) => !open && setRemoving(null)}
				title={`Delete ${removing?.name}?`}
				description="The people in it stay on your list. An issue that was going to this segment will ask you to choose who it goes to again, and is never sent to everyone."
				confirmLabel="Delete"
				successMessage="Segment deleted"
				destructive
				onConfirm={async () => {
					const result = await removeSegment(removing.id);
					if (!result?.error) router.refresh();
					return result;
				}}
			/>
		</>
	);
}
