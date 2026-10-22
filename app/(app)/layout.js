import Link from "next/link";
import { redirect } from "next/navigation";
import BannerSuspended from "@/components/BannerSuspended";
import LogoApp from "@/components/LogoApp";
import NavFooter from "@/components/NavFooter";
import NavLinks from "@/components/NavLinks";
import NavMobile from "@/components/NavMobile";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { APP_NAME } from "@/lib/config";
import { getWorkspaceContext } from "@/lib/workspace";

export default async function AppLayout({ children }) {
	const context = await getWorkspaceContext();
	if (!context) redirect("/login");
	const { session, workspace, workspaces, role, isSuspended } = context;
	// Someone with no workspace and no platform role has nothing to see here.
	if (!workspace && !session.isPlatformAdmin) redirect("/no-workspace");

	const user = { name: session.name, email: session.email };
	// An account that only runs the platform has no workspace: just the console, no newsletters or contacts.
	const switcher = workspace ? (
		<WorkspaceSwitcher workspaces={workspaces} currentId={workspace.id} isPlatformAdmin={false} />
	) : (
		<div className="flex h-11 items-center gap-2.5 rounded-lg px-3 shadow-border">
			<span className="flex min-w-0 flex-col">
				<span className="truncate text-sm leading-tight font-medium">Platform</span>
				<span className="truncate text-xs leading-tight text-muted-foreground">Administrator</span>
			</span>
		</div>
	);
	const showWorkspace = Boolean(workspace);

	return (
		<div className="flex min-h-dvh flex-col md:flex-row">
			<aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border/60 px-3 py-4 md:flex">
				<Link href={workspace ? "/" : "/platform"} className="mb-4 flex h-9 items-center gap-2 px-2.5">
					<LogoApp />
					<span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
				</Link>
				<div className="mb-4">{switcher}</div>
				<NavLinks role={role} isPlatformAdmin={session.isPlatformAdmin} showWorkspace={showWorkspace} />
				<div className="mt-auto">
					<NavFooter user={user} />
				</div>
			</aside>
			<NavMobile
				footer={<NavFooter user={user} />}
				switcher={switcher}
				role={role}
				isPlatformAdmin={session.isPlatformAdmin}
				showWorkspace={showWorkspace}
			/>
			<main className="min-w-0 flex-1">
				<div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-10">
					{isSuspended && <BannerSuspended workspaceName={workspace.name} />}
					{children}
				</div>
			</main>
		</div>
	);
}
