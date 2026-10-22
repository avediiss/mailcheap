import AvatarInitials from "@/components/AvatarInitials";
import { ButtonSignOutEverywhere, FormPassword, FormProfile } from "@/components/FormAccount";
import HeaderPage from "@/components/HeaderPage";
import { roleLabel } from "@/lib/roles";
import { getWorkspaceContext } from "@/lib/workspace";
import { redirect } from "next/navigation";

export const metadata = { title: "Account" };

export default async function AccountPage() {
	const context = await getWorkspaceContext();
	if (!context) redirect("/login");
	const { session, workspaces } = context;

	return (
		<>
			<HeaderPage title="Account" />
			<div className="flex max-w-2xl flex-col gap-8">
				<Section title="Profile" stagger={0}>
					<FormProfile name={session.name} email={session.email} />
				</Section>

				<Section title="Your access" stagger={1}>
					{session.isPlatformAdmin && (
						<p className="border-b border-border/60 px-4 py-3 text-sm sm:px-5">
							<span className="font-medium">Platform administrator.</span>{" "}
							<span className="text-muted-foreground">You run the platform from the Platform section. That access doesn’t include the inside of clients’ workspaces.</span>
						</p>
					)}
					{workspaces.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground sm:px-5">No workspace. This account only runs the platform.</p>}
					<ul className="divide-y divide-border/60">
						{workspaces.map((workspace) => (
							<li key={workspace.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
								<AvatarInitials name={workspace.name} size={28} shape="square" />
								<span className="min-w-0 flex-1 truncate text-sm font-medium">{workspace.name}</span>
								<span className="text-sm text-muted-foreground">{roleLabel(workspace.role)}</span>
							</li>
						))}
					</ul>
				</Section>

				<Section title="Password" stagger={2}>
					<FormPassword />
				</Section>

				<Section title="Sessions" stagger={3}>
					<div className="flex flex-col items-start gap-3 p-4 sm:p-5">
						<p className="text-sm text-pretty text-muted-foreground">
							Lost a device, or used a shared computer? This logs you out on every browser, this one included.
						</p>
						<ButtonSignOutEverywhere />
					</div>
				</Section>
			</div>
		</>
	);
}

function Section({ title, stagger, children }) {
	return (
		<section style={{ "--stagger": stagger }} className="flex flex-col gap-3 animate-enter">
			<h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
			<div className="overflow-hidden rounded-xl bg-card shadow-border">{children}</div>
		</section>
	);
}
