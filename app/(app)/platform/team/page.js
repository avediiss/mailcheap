import DialogInvitePlatformAdmin from "@/components/DialogInvitePlatformAdmin";
import HeaderPage from "@/components/HeaderPage";
import ListPlatformTeam from "@/components/ListPlatformTeam";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";
import { listPlatformAdmins, listPlatformInvitations } from "@/lib/platform-team";

export const metadata = { title: "Team" };

export default async function PlatformTeamPage() {
	const session = await requirePlatformAdmin();
	const [admins, invitations] = await Promise.all([listPlatformAdmins(), listPlatformInvitations()]);

	return (
		<>
			<HeaderPage title="Team">
				<DialogInvitePlatformAdmin />
			</HeaderPage>
			<p className="-mt-4 mb-6 max-w-2xl text-sm text-pretty text-muted-foreground animate-enter">
				The accounts that run the platform. An administrator controls and checks clients from the console, but can’t read the inside of a
				workspace: that needs an invitation from the client, like anyone else. For the cleanest setup, keep an administrator-only account
				apart from the account you use for your own newsletter.
			</p>
			<div className="max-w-3xl animate-enter">
				<ListPlatformTeam
					admins={admins.map(({ lastLoginAt, ...admin }) => ({ ...admin, lastSeen: lastLoginAt ? formatRelative(lastLoginAt) : "Never logged in" }))}
					invitations={invitations.map(({ expiresAt, ...invitation }) => ({ ...invitation, expires: formatDate(expiresAt) }))}
					currentUserId={session.userId}
				/>
			</div>
		</>
	);
}
