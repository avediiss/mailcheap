import { UserCog } from "lucide-react";
import DialogInviteMember from "@/components/DialogInviteMember";
import HeaderPage from "@/components/HeaderPage";
import ListInvitations from "@/components/ListInvitations";
import ListMembers from "@/components/ListMembers";
import { formatDate, formatRelative } from "@/lib/format";
import { describeRole, roleLabel } from "@/lib/invitation-rules";
import { listInvitations, listMembers } from "@/lib/members";
import { requireWorkspace } from "@/lib/workspace";
import { hasRole } from "@/lib/workspace-rules";

export const metadata = { title: "Members" };

export default async function MembersPage() {
	const { workspace, workspaceId, role, session, isSuspended } = await requireWorkspace();
	const canManage = hasRole(role, "owner") && !isSuspended;
	const [members, invitations] = await Promise.all([listMembers(workspaceId), listInvitations(workspaceId)]);

	// Dates are worded here, on the server, so the page reads the same before and after it loads.
	const rows = members.map(({ joinedAt, lastLoginAt, ...member }) => ({
		...member,
		lastSeen: lastLoginAt ? formatRelative(lastLoginAt) : "Never",
	}));
	const pending = invitations.map(({ expiresAt, lastSentAt, ...invitation }) => ({ ...invitation, expires: formatDate(expiresAt) }));

	return (
		<>
			<HeaderPage title="Members">{canManage && <DialogInviteMember />}</HeaderPage>

			<div className="flex flex-col gap-8">
				<section className="flex flex-col gap-3 animate-enter">
					<p className="text-sm text-pretty text-muted-foreground">
						People who can work in <span className="font-medium text-foreground">{workspace.name}</span>.
						{!canManage && !isSuspended && " Only an owner can change this list."}
					</p>
					<ListMembers members={rows} currentUserId={session.userId} canManage={canManage} />
				</section>

				{pending.length > 0 && (
					<section style={{ "--stagger": 1 }} className="flex flex-col gap-3 animate-enter">
						<h2 className="text-sm font-medium text-muted-foreground">Invitations waiting</h2>
						<ListInvitations invitations={pending} canManage={canManage} />
					</section>
				)}

				<section style={{ "--stagger": 2 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
						<UserCog className="size-4" />
						What each role can do
					</h2>
					<dl className="grid gap-px overflow-hidden rounded-xl bg-border/60 shadow-border sm:grid-cols-2">
						{["owner", "editor"].map((value) => (
							<div key={value} className="flex flex-col gap-1 bg-card px-4 py-3">
								<dt className="text-sm font-medium">{roleLabel(value)}</dt>
								<dd className="text-sm text-pretty text-muted-foreground">{describeRole(value)}</dd>
							</div>
						))}
					</dl>
				</section>
			</div>
		</>
	);
}
