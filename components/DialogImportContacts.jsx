"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";
import { finishImport, importContacts, startImport, uploadImportChunk } from "@/app/(app)/contacts/actions";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { fieldKeyFromLabel } from "@/lib/contact-fields";
import { MAX_IMPORT_ROWS_PER_REQUEST, mapColumns, normalizeImportRow } from "@/lib/csv-import";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// Up to this many rows in one file (lib/import-jobs.js). More than one request's worth goes through the background.
const MAX_IMPORT_ROWS = 250_000;
const MAX_NEW_FIELDS = 10;
const BUILT_IN_TARGETS = [
	["email", "Email", true],
	["firstName", "First name"],
	["status", "Status"],
	["subscribedAt", "Joined date"],
	["tags", "Tags"],
];

const selectClass = "h-8 w-44 rounded-lg bg-card px-2 text-sm shadow-border outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export default function DialogImportContacts({ newsletters, defaultNewsletterId, fieldDefs = [] }) {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const [newsletterId, setNewsletterId] = useState(defaultNewsletterId || newsletters[0]?.id || "");
	const [mode, setMode] = useState("file");
	const [file, setFile] = useState(null);
	const [parsed, setParsed] = useState(null);
	const [columns, setColumns] = useState(null);
	const [newFields, setNewFields] = useState([]);
	const [progress, setProgress] = useState(null);
	const [isImporting, startImporting] = useTransition();

	// Columns kept as new fields are given the key they will get, so the rows can be built before the field exists.
	const effectiveColumns = useMemo(
		() => (columns ? { ...columns, fields: { ...columns.fields, ...Object.fromEntries(newFields.map((header) => [fieldKeyFromLabel(header), header])) } } : null),
		[columns, newFields]
	);
	const rows = useMemo(() => {
		if (!parsed || !effectiveColumns?.email) return [];
		const options = mode === "dormant" ? { status: "dormant" } : {};
		return parsed.rows.map((row) => normalizeImportRow(row, effectiveColumns, options)).filter(Boolean);
	}, [parsed, effectiveColumns, mode]);
	const statusCounts = useMemo(
		() => Object.entries(Object.groupBy(rows, ({ status }) => status)).map(([status, group]) => [status, group.length]),
		[rows]
	);
	const usedHeaders = useMemo(
		() => new Set([...BUILT_IN_TARGETS.map(([key]) => columns?.[key]), ...Object.values(columns?.fields ?? {}), ...newFields].filter(Boolean)),
		[columns, newFields]
	);
	const spareHeaders = (parsed?.headers ?? []).filter((header) => !usedHeaders.has(header));
	const isBackground = rows.length > MAX_IMPORT_ROWS_PER_REQUEST || newFields.length > 0;

	function reset() {
		setFile(null);
		setParsed(null);
		setColumns(null);
		setNewFields([]);
		setProgress(null);
	}

	function loadFile(selected) {
		if (!selected) return;
		setFile(selected);
		Papa.parse(selected, {
			header: true,
			skipEmptyLines: true,
			complete: ({ data, meta }) => {
				const headers = meta.fields ?? [];
				const mapped = mapColumns(headers, fieldDefs);
				if (!mapped.email) {
					// No email column found by name: the person picks one below.
					toast.info("Choose which column holds the email addresses.");
				}
				if (data.length > MAX_IMPORT_ROWS) {
					toast.error(`A file can have up to ${formatNumber(MAX_IMPORT_ROWS)} rows. Split it and import the parts.`);
					return reset();
				}
				setParsed({ rows: data, headers });
				setColumns(mapped);
				setNewFields([]);
			},
			error: () => toast.error("Could not read this file"),
		});
	}

	function setBuiltIn(key, header) {
		setColumns((current) => ({ ...current, [key]: header || null }));
		setNewFields((current) => current.filter((existing) => existing !== header));
	}

	function setField(key, header) {
		setColumns((current) => {
			const fields = { ...current.fields };
			if (header) fields[key] = header;
			else delete fields[key];
			return { ...current, fields };
		});
	}

	function toggleNewField(header) {
		setNewFields((current) => (current.includes(header) ? current.filter((existing) => existing !== header) : current.length < MAX_NEW_FIELDS ? [...current, header] : current));
	}

	function finishWithToasts(totals) {
		toast.success(`${formatNumber(totals.created)} added, ${formatNumber(totals.existing)} already there`);
		// The workspace's contact limit stopped some: say so, with what to do about it.
		if (totals.skippedOverLimit > 0) {
			toast.error(
				`${formatNumber(totals.skippedOverLimit)} not added: this workspace has reached its contact limit. Ask the platform owner to raise it.`,
				{ duration: 12000 }
			);
		}
		// Addresses left out because they are typos, throwaway inboxes or can't receive mail: say how many and why.
		const left = describeRejected(totals.rejected);
		if (left) toast.info(left, { duration: 12000 });
	}

	// A small file: added now, in this window.
	async function importNow() {
		const totals = { created: 0, existing: 0, invalid: 0, skippedOverLimit: 0, rejected: { typo: 0, disposable: 0, blocked: 0, undeliverable: 0 } };
		for (let start = 0; start < rows.length; start += MAX_IMPORT_ROWS_PER_REQUEST) {
			setProgress(start / rows.length);
			const result = await importContacts({ newsletterId, rows: rows.slice(start, start + MAX_IMPORT_ROWS_PER_REQUEST) });
			if (result?.error) {
				toast.error(result.error);
				return setProgress(null);
			}
			totals.created += result.created;
			totals.existing += result.existing;
			totals.invalid += result.invalid;
			totals.skippedOverLimit += result.skippedOverLimit ?? 0;
			for (const reason of Object.keys(totals.rejected)) totals.rejected[reason] += result.rejected?.[reason] ?? 0;
		}
		setProgress(1);
		finishWithToasts(totals);
		setIsOpen(false);
		reset();
		router.refresh();
	}

	// A big file: the rows go up in parts, then a background job adds them and the window can be closed.
	async function importInBackground() {
		const started = await startImport({
			newsletterId,
			fileName: file?.name,
			totalRows: rows.length,
			newFields: newFields.map((header) => ({ header, label: header })),
		});
		if (started?.error) {
			toast.error(started.error);
			return setProgress(null);
		}
		for (let index = 0; index * started.chunkRows < rows.length; index++) {
			setProgress((index * started.chunkRows) / rows.length);
			const result = await uploadImportChunk({ jobId: started.jobId, index, rows: rows.slice(index * started.chunkRows, (index + 1) * started.chunkRows) });
			if (result?.error) {
				toast.error(result.error);
				return setProgress(null);
			}
		}
		const finished = await finishImport(started.jobId);
		if (finished?.error) {
			toast.error(finished.error);
			return setProgress(null);
		}
		setProgress(1);
		toast.success("Import started. You can close this page: the progress shows here, and you'll get an email when it finishes.", { duration: 10000 });
		setIsOpen(false);
		reset();
		router.refresh();
	}

	function runImport() {
		startImporting(async () => {
			if (isBackground) await importInBackground();
			else await importNow();
		});
	}

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (isImporting) return;
				setIsOpen(open);
				if (!open) reset();
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" disabled={newsletters.length === 0}>
					<Upload data-icon="inline-start" />
					Import
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Import contacts</DialogTitle>
					<DialogDescription>
						CSV with an email column, up to {formatNumber(MAX_IMPORT_ROWS)} rows. Existing contacts keep their status and what you’ve filled in.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<div className="grid grid-cols-2 gap-2">
						<Select value={newsletterId} onValueChange={setNewsletterId} disabled={isImporting}>
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
						<Select value={mode} onValueChange={setMode} disabled={isImporting}>
							<SelectTrigger className="h-9 w-full" aria-label="Status">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="file">Status from file</SelectItem>
								<SelectItem value="dormant">Import as dormant</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<label
						onDragOver={(event) => event.preventDefault()}
						onDrop={(event) => {
							event.preventDefault();
							loadFile(event.dataTransfer.files?.[0]);
						}}
						className={cn(
							"flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl px-4 py-8 text-center shadow-border transition-[box-shadow,background-color] duration-150 hover:bg-muted/40 hover:shadow-border-hover",
							isImporting && "pointer-events-none opacity-60"
						)}
					>
						<FileUp className="size-5 text-muted-foreground" />
						<span className="max-w-full truncate text-sm font-medium">{file ? file.name : "Choose or drop a CSV file"}</span>
						{parsed && (
							<span className="text-xs text-muted-foreground tabular-nums">
								{formatNumber(rows.length)} valid of {formatNumber(parsed.rows.length)} rows
							</span>
						)}
						<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => loadFile(event.target.files?.[0])} />
					</label>

					{parsed && columns && (
						<details className="rounded-xl shadow-border" open={!columns.email}>
							<summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Match the columns</summary>
							<div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3">
								{BUILT_IN_TARGETS.map(([key, label, isRequired]) => (
									<MappingRow key={key} label={label} isRequired={isRequired} value={columns[key] ?? ""} headers={parsed.headers} disabled={isImporting} onChange={(header) => setBuiltIn(key, header)} />
								))}
								{fieldDefs.map(({ key, label }) => (
									<MappingRow key={key} label={label} value={columns.fields?.[key] ?? ""} headers={parsed.headers} disabled={isImporting} onChange={(header) => setField(key, header)} />
								))}
								{spareHeaders.length > 0 && (
									<div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-3">
										<span className="text-xs text-muted-foreground">Keep these other columns as new fields (up to {MAX_NEW_FIELDS}):</span>
										<div className="flex flex-wrap gap-1.5">
											{spareHeaders.slice(0, 30).map((header) => (
												<button
													key={header}
													type="button"
													onClick={() => toggleNewField(header)}
													className={cn("h-7 rounded-full px-2.5 text-xs transition-colors duration-150", "text-muted-foreground shadow-border hover:bg-muted")}
												>
													+ {header}
												</button>
											))}
										</div>
									</div>
								)}
								{newFields.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{newFields.map((header) => (
											<button key={header} type="button" onClick={() => toggleNewField(header)} className="h-7 rounded-full bg-foreground px-2.5 text-xs text-background" title="Remove">
												{header} · new field ×
											</button>
										))}
									</div>
								)}
							</div>
						</details>
					)}

					{rows.length > 0 && (
						<div className="overflow-x-auto rounded-xl shadow-border">
							<table className="w-full text-left text-xs">
								<thead className="text-muted-foreground">
									<tr>
										<th className="px-3 py-2 font-medium">Email</th>
										<th className="px-3 py-2 font-medium">Name</th>
										<th className="px-3 py-2 font-medium">Status</th>
										<th className="px-3 py-2 font-medium">Tags</th>
									</tr>
								</thead>
								<tbody>
									{rows.slice(0, 4).map((row) => (
										<tr key={row.email} className="border-t border-border/60">
											<td className="max-w-40 truncate px-3 py-1.5">{row.email}</td>
											<td className="px-3 py-1.5">{row.firstName ?? ""}</td>
											<td className="px-3 py-1.5">{row.status}</td>
											<td className="max-w-32 truncate px-3 py-1.5">{(row.tags ?? []).join(", ")}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{statusCounts.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{statusCounts.map(([status, count]) => (
								<span key={status} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-xs text-muted-foreground tabular-nums">
									{status} <span className="text-foreground">{formatNumber(count)}</span>
								</span>
							))}
						</div>
					)}

					{isBackground && rows.length > 0 && (
						<p className="text-xs text-pretty text-muted-foreground">
							This one is added in the background, so you can close the page once it is uploaded. You’ll get an email when it finishes.
						</p>
					)}

					{progress !== null && (
						<div className="h-1.5 overflow-hidden rounded-full bg-muted">
							<div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${Math.max(progress, 0.02) * 100}%` }} />
						</div>
					)}
				</div>

				<DialogFooter>
					<Button onClick={runImport} disabled={!newsletterId || rows.length === 0 || isImporting} className="min-w-24">
						{isImporting ? <Loader2 className="animate-spin" /> : `Import ${rows.length ? formatNumber(rows.length) : ""}`.trim()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function MappingRow({ label, value, headers, isRequired = false, disabled, onChange }) {
	return (
		<label className="flex items-center justify-between gap-3 text-sm">
			<span className={cn(isRequired && "font-medium")}>
				{label}
				{isRequired && <span className="text-destructive"> *</span>}
			</span>
			<select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={selectClass}>
				<option value="">{isRequired ? "Choose a column" : "Not in the file"}</option>
				{headers.map((header) => (
					<option key={header} value={header}>
						{header}
					</option>
				))}
			</select>
		</label>
	);
}

// "12 not added: 5 typos, 4 temporary inboxes, 3 on domains that can't receive email." or "" when none.
function describeRejected({ typo, disposable, blocked, undeliverable }) {
	const parts = [
		typo && `${formatNumber(typo)} ${typo === 1 ? "typo" : "typos"} (like gmial.com)`,
		disposable && `${formatNumber(disposable)} temporary ${disposable === 1 ? "inbox" : "inboxes"}`,
		blocked && `${formatNumber(blocked)} on blocked domains`,
		undeliverable && `${formatNumber(undeliverable)} on domains that can't receive email`,
	].filter(Boolean);
	const total = typo + disposable + blocked + undeliverable;
	return total ? `${formatNumber(total)} not added: ${parts.join(", ")}.` : "";
}
