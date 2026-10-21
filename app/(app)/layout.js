import Link from "next/link";
import BannerSuspended from "@/components/BannerSuspended";
import LogoMailcheap from "@/components/LogoMailcheap";
import NavFooter from "@/components/NavFooter";
import NavLinks from "@/components/NavLinks";
import NavMobile from "@/components/NavMobile";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { requireWorkspace } from "@/lib/workspace";

export default async function AppLayout({ children }) {
	const { session, workspace, workspaces, role, isSuspended } = await requireWorkspace();
	const user = { name: session.name, email: session.email };
	const switcher = <WorkspaceSwitcher workspaces={workspaces} currentId={workspace.id} isPlatformAdmin={session.isPlatformAdmin} />;

	return (
		<div className="flex min-h-dvh flex-col md:flex-row">
			<aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border/60 px-3 py-4 md:flex">
				<Link href="/" className="mb-4 flex h-9 items-center gap-2 px-2.5">
					<LogoMailcheap />
					<span className="text-sm font-semibold tracking-tight">Mailcheap</span>
				</Link>
				<div className="mb-4">{switcher}</div>
				<NavLinks role={role} />
				<div className="mt-auto">
					<NavFooter user={user} />
				</div>
			</aside>
			<NavMobile footer={<NavFooter user={user} />} switcher={switcher} role={role} />
			<main className="min-w-0 flex-1">
				<div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-10">
					{isSuspended && <BannerSuspended workspaceName={workspace.name} />}
					{children}
				</div>
			</main>
		</div>
	);
}
