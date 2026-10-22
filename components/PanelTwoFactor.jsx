"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Download, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { finishTwoFactorSetup, newRecoveryCodes, startTwoFactorSetup, turnOffTwoFactor } from "@/app/(app)/account/actions";
import ButtonCopy from "@/components/ButtonCopy";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// Two-factor login on the account page: set it up (scan, confirm, save recovery codes), see its state, get new
// recovery codes, turn it off. isRequired: administrators can't turn it off.
export default function PanelTwoFactor({ isOn, since, recoveryLeft, isRequired }) {
	const [setup, setSetup] = useState(null);
	const [codes, setCodes] = useState(null);
	const [dialog, setDialog] = useState(null);
	const [isStarting, startTransition] = useTransition();

	function begin() {
		startTransition(async () => {
			const result = await startTwoFactorSetup();
			if (result.error) toast.error(result.error);
			else setSetup(result);
		});
	}

	if (codes) return <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />;
	if (setup) return <SetupSteps setup={setup} onCancel={() => setSetup(null)} onDone={(recoveryCodes) => { setSetup(null); setCodes(recoveryCodes); }} />;

	return (
		<div className="flex flex-col items-start gap-3 p-4 sm:p-5">
			{isOn ? (
				<>
					<p className="flex items-center gap-2 text-sm font-medium">
						<ShieldCheck className="size-4 text-emerald-600" />
						On since {since}
					</p>
					<p className="text-sm text-pretty text-muted-foreground">
						Logging in asks for a code from your authenticator app. {recoveryLeft} of 10 recovery codes left.
						{recoveryLeft <= 2 && " Make new ones soon."}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => setDialog("codes")}>New recovery codes</Button>
						{!isRequired && <Button variant="outline" onClick={() => setDialog("off")}>Turn off</Button>}
					</div>
					{isRequired && <p className="text-xs text-muted-foreground">Platform administrators must keep this on.</p>}
				</>
			) : (
				<>
					<p className="text-sm text-pretty text-muted-foreground">
						Add a second step to logging in: a 6-digit code from an app like Google Authenticator, 1Password or Authy. A stolen password alone then isn’t enough to get in.
					</p>
					<Button onClick={begin} disabled={isStarting} className="min-w-28">
						{isStarting ? <Loader2 className="animate-spin" /> : "Set up"}
					</Button>
				</>
			)}

			<DialogForm open={dialog === "codes"} onClose={() => setDialog(null)} title="New recovery codes" description="The old ones stop working. Enter a code from your authenticator app to confirm." action={newRecoveryCodes} onSuccess={(result) => { setDialog(null); setCodes(result.recoveryCodes); }} submitLabel="Make new codes" />
			<DialogForm open={dialog === "off"} onClose={() => setDialog(null)} title="Turn off two-factor login?" description="Your account will be protected by the password alone. Enter your password and a code to confirm." action={turnOffTwoFactor} onSuccess={() => { setDialog(null); toast.success("Two-factor login is off"); }} submitLabel="Turn off" withPassword destructive />
		</div>
	);
}

function SetupSteps({ setup, onCancel, onDone }) {
	const [state, action, isPending] = useActionState(async (previous, formData) => {
		const result = await finishTwoFactorSetup(previous, formData);
		if (result.ok) onDone(result.recoveryCodes);
		return result;
	}, null);

	return (
		<form action={action} className="flex flex-col gap-5 p-4 sm:p-5">
			<div className="flex flex-col gap-1">
				<p className="text-sm font-medium">1. Scan this with your authenticator app</p>
				<div className="flex flex-wrap items-center gap-5">
					<div aria-label="QR code" role="img" className="size-44 shrink-0 rounded-lg bg-white p-1.5 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: setup.qr }} />
					<div className="flex min-w-0 flex-col gap-1.5 text-sm">
						<span className="text-muted-foreground">Can’t scan? Enter this key instead:</span>
						<span className="flex items-center gap-1">
							<code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">{setup.secret.match(/.{1,4}/g).join(" ")}</code>
							<ButtonCopy value={setup.secret} label="Copy key" />
						</span>
					</div>
				</div>
			</div>
			<div className="flex flex-col gap-2">
				<p className="text-sm font-medium">2. Enter the 6-digit code it shows</p>
				<Input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" required spellCheck={false} className="w-40 font-mono tracking-widest" />
				{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			</div>
			<div className="flex gap-2">
				<Button type="submit" disabled={isPending} className="min-w-28">
					{isPending ? <Loader2 className="animate-spin" /> : "Turn on"}
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
			</div>
		</form>
	);
}

function RecoveryCodes({ codes, onDone }) {
	const [isSaved, setIsSaved] = useState(false);
	const text = codes.join("\n");

	function download() {
		const url = URL.createObjectURL(new Blob([`Namag recovery codes\nEach works once.\n\n${text}\n`], { type: "text/plain" }));
		const link = Object.assign(document.createElement("a"), { href: url, download: "namag-recovery-codes.txt" });
		link.click();
		URL.revokeObjectURL(url);
	}

	return (
		<div className="flex flex-col gap-4 p-4 sm:p-5">
			<div className="flex flex-col gap-1">
				<p className="flex items-center gap-2 text-sm font-medium">
					<ShieldCheck className="size-4 text-emerald-600" />
					Two-factor login is on. Save your recovery codes.
				</p>
				<p className="text-sm text-pretty text-muted-foreground">If you lose your phone, each of these lets you in once. They are shown only now: keep them somewhere safe, like a password manager.</p>
			</div>
			<ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-lg bg-muted/60 p-3 font-mono text-sm sm:grid-cols-2">
				{codes.map((code) => (
					<li key={code}>{code}</li>
				))}
			</ul>
			<div className="flex flex-wrap items-center gap-2">
				<Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}>Copy</Button>
				<Button type="button" variant="outline" size="sm" onClick={download}><Download />Download</Button>
			</div>
			<label className="flex items-center gap-2 text-sm">
				<input type="checkbox" checked={isSaved} onChange={(event) => setIsSaved(event.target.checked)} className="size-4" />
				I have saved these codes
			</label>
			<div>
				<Button type="button" disabled={!isSaved} onClick={onDone} className="min-w-24"><Check />Done</Button>
			</div>
		</div>
	);
}

function DialogForm({ open, onClose, title, description, action, onSuccess, submitLabel, withPassword = false, destructive = false }) {
	const [state, formAction, isPending] = useActionState(async (previous, formData) => {
		const result = await action(previous, formData);
		if (result.ok) onSuccess(result);
		return result;
	}, null);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-md">
				<form action={formAction} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{description}</DialogDescription>
					</DialogHeader>
					{withPassword && <Input name="password" type="password" autoComplete="current-password" placeholder="Your password" required />}
					<Input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="Code from your app" required spellCheck={false} className="font-mono tracking-widest" />
					{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
						<Button type="submit" variant={destructive ? "destructive" : "default"} disabled={isPending}>
							{isPending ? <Loader2 className="animate-spin" /> : submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
