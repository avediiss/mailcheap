import { KeyRound } from "lucide-react";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonCopy from "@/components/ButtonCopy";
import ButtonRevokeApiKey from "@/components/ButtonRevokeApiKey";
import DialogCreateApiKey from "@/components/DialogCreateApiKey";
import HeaderPage from "@/components/HeaderPage";
import StateEmpty from "@/components/StateEmpty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getAppUrl } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { formatDate, formatRelative } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace";
import { hasRole } from "@/lib/workspace-rules";
import ApiKey from "@/models/ApiKey";
import Newsletter from "@/models/Newsletter";
import { redirect } from "next/navigation";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
	const { workspaceId, role, workspace } = await requireWorkspace();
	// Keys reach everything in the workspace, so only its owners see and manage them.
	if (!hasRole(role, "owner")) redirect("/");
	await connectDb();
	const [apiKeys, newsletters] = await Promise.all([
		ApiKey.find({ workspaceId }).sort({ createdAt: -1 }).select("-hash").lean(),
		Newsletter.find({ workspaceId }).sort({ createdAt: 1 }).select({ name: 1, slug: 1 }).lean(),
	]);
	const examples = getExamples(getAppUrl(), newsletters[0]?.slug ?? "your-newsletter");

	return (
		<>
			<HeaderPage title="API keys">
				<DialogCreateApiKey />
			</HeaderPage>

			<p className="-mt-4 mb-6 max-w-2xl text-sm text-pretty text-muted-foreground animate-enter">
				Keys for <span className="font-medium text-foreground">{workspace.name}</span>. Each key can add contacts and drafts to{" "}
				{newsletters.length === 0 ? "the newsletters you create here" : "every newsletter in this workspace"}
				{newsletters.length > 0 && (
					<>
						:{" "}
						{newsletters.map(({ slug }, index) => (
							<span key={slug}>
								{index > 0 && ", "}
								<code className="font-mono text-[13px] text-foreground">{slug}</code>
							</span>
						))}
					</>
				)}
				. It can’t reach anything else.
			</p>

			<div className="flex flex-col gap-8">
				{apiKeys.length === 0 ? (
					<StateEmpty icon={KeyRound} title="No API keys yet" />
				) : (
					<div className="overflow-hidden rounded-xl shadow-border animate-enter">
						<Table>
							<TableHeader>
								<TableRow className="hover:bg-transparent">
									<TableHead className="pl-4">Name</TableHead>
									<TableHead>Key</TableHead>
									<TableHead className="hidden sm:table-cell">Created</TableHead>
									<TableHead className="hidden sm:table-cell">Last used</TableHead>
									<TableHead className="w-24 pr-2" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{apiKeys.map((apiKey) => (
									<TableRow key={apiKey._id.toString()}>
										<TableCell className="py-2.5 pl-4 font-medium">{apiKey.name}</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground">{apiKey.prefix}</TableCell>
										<TableCell className="hidden text-muted-foreground sm:table-cell">
											{formatDate(apiKey.createdAt)}
										</TableCell>
										<TableCell className="hidden text-muted-foreground sm:table-cell">
											{apiKey.lastUsedAt ? formatRelative(apiKey.lastUsedAt) : "Never"}
										</TableCell>
										<TableCell className="pr-2 text-right">
											{apiKey.revokedAt ? (
												<BadgeStatus status="revoked" />
											) : (
												<ButtonRevokeApiKey id={apiKey._id.toString()} name={apiKey.name} />
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}

				<section style={{ "--stagger": 1 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Usage</h2>
					{examples.map(({ title, code }) => (
						<div key={title} className="overflow-hidden rounded-xl bg-card shadow-border">
							<div className="flex h-10 items-center justify-between border-b border-border/60 pr-2 pl-4">
								<span className="text-sm">{title}</span>
								<ButtonCopy value={code} label="Copy" />
							</div>
							<pre className="overflow-x-auto p-4 font-mono text-xs leading-5 text-muted-foreground">
								{code}
							</pre>
						</div>
					))}
				</section>
			</div>
		</>
	);
}

function getExamples(appUrl, slug) {
	return [
		{
			title: "Add a contact",
			code: `curl -X POST ${appUrl}/api/v1/contacts \\
  -H "Authorization: Bearer $MAILCHEAP_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"newsletter":"${slug}","email":"jane@example.com","source":"website"}'`,
		},
		{
			title: "Create a draft campaign",
			code: `curl -X POST ${appUrl}/api/v1/campaigns \\
  -H "Authorization: Bearer $MAILCHEAP_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"newsletter":"${slug}","subject":"This week","previewText":"...","html":"<html>...</html>"}'`,
		},
	];
}
