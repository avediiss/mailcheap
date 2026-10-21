import { redirect } from "next/navigation";
import LogoMailcheap from "@/components/LogoMailcheap";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata = { title: "No workspace" };

export default async function NoWorkspacePage() {
	const context = await getWorkspaceContext();
	if (!context) redirect("/login");
	if (context.workspace) redirect("/");

	return (
		<main className="flex min-h-dvh items-center justify-center px-4">
			<div className="w-full max-w-sm text-center">
				<LogoMailcheap className="mx-auto mb-6 size-10" />
				<h1 className="text-lg font-semibold tracking-tight">You’re not in a workspace yet</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Ask whoever invited you to add you to one. Once they have, refresh this page.
				</p>
			</div>
		</main>
	);
}
