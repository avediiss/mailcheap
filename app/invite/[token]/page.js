import Link from "next/link";
import { logout } from "@/app/(app)/actions";
import { FormAcceptInvite, FormJoinWorkspace } from "@/components/FormAcceptInvite";
import LogoMailcheap from "@/components/LogoMailcheap";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth";
import { findInvitationByToken } from "@/lib/members";

export const metadata = { title: "Join a workspace", referrer: "no-referrer" };

const PROBLEMS = {
	invalid: ["This link isn’t valid", "Check that you copied the whole link, or ask for a new invitation."],
	expired: ["This invitation has expired", "Invitations work for 7 days. Ask for a new one."],
	revoked: ["This invitation was cancelled", "Ask whoever invited you to send a new one."],
	accepted: ["This invitation was already used", "If that was you, log in to continue."],
};

export default async function InvitePage({ params }) {
	const { token } = await params;
	const [invitation, session] = await Promise.all([findInvitationByToken(token), getSession()]);

	return (
		<main className="flex min-h-dvh items-center justify-center px-4">
			<div className="w-full max-w-sm">
				<div className="mb-8 flex flex-col items-center gap-3 text-center">
					<LogoMailcheap className="size-10" />
					<Heading invitation={invitation} />
				</div>
				<Body invitation={invitation} session={session} token={token} />
			</div>
		</main>
	);
}

function Heading({ invitation }) {
	if (invitation.state !== "usable") {
		const [title, detail] = PROBLEMS[invitation.state] ?? PROBLEMS.invalid;
		return (
			<>
				<h1 className="text-lg font-semibold tracking-tight">{title}</h1>
				<p className="text-sm text-pretty text-muted-foreground">{detail}</p>
			</>
		);
	}
	return (
		<>
			<h1 className="text-lg font-semibold tracking-tight">Join {invitation.workspaceName}</h1>
			<p className="text-sm text-pretty text-muted-foreground">
				You’ve been invited as {invitation.role === "owner" ? "an owner" : "an editor"}.
			</p>
		</>
	);
}

function Body({ invitation, session, token }) {
	if (invitation.state !== "usable") {
		return (
			<div className="text-center">
				<Link href="/login" className="text-sm text-muted-foreground hover:underline">
					Go to log in
				</Link>
			</div>
		);
	}
	if (invitation.isAccountDisabled) {
		return <p className="text-center text-sm text-muted-foreground">This account has been disabled. Contact the platform owner.</p>;
	}

	if (!invitation.hasAccount) return <FormAcceptInvite token={token} email={invitation.email} />;

	// They have an account: they must be logged in as the invited address to accept.
	if (session?.email === invitation.email) return <FormJoinWorkspace token={token} workspaceName={invitation.workspaceName} />;
	if (session) {
		return (
			<div className="flex flex-col gap-4 text-center text-sm">
				<p className="text-pretty text-muted-foreground">
					You’re logged in as {session.email}, but this invitation is for {invitation.email}. Log out, then open the invitation link again.
				</p>
				<form action={logout}>
					<Button type="submit" size="lg" className="w-full">
						Log out
					</Button>
				</form>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-4 text-center text-sm">
			<p className="text-pretty text-muted-foreground">{invitation.email} already has an account. Log in to accept the invitation.</p>
			<Button asChild size="lg">
				<Link href={`/login?next=/invite/${token}`}>Log in</Link>
			</Button>
		</div>
	);
}
