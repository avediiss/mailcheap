import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import ButtonsReview from "@/components/ButtonsReview";
import HeaderPage from "@/components/HeaderPage";
import { requirePlatformAdmin } from "@/lib/auth";
import { toPlainText } from "@/lib/content-scan";
import { listPendingReviews } from "@/lib/content-review";
import { formatRelative } from "@/lib/format";

export const metadata = { title: "Review" };

const EXCERPT_LENGTH = 900;

export default async function ReviewPage() {
	await requirePlatformAdmin();
	const pending = await listPendingReviews();

	return (
		<>
			<HeaderPage title="Review" />
			<p className="-mt-4 mb-6 max-w-2xl text-sm text-pretty text-muted-foreground animate-enter">
				Issues the automatic scan thinks could be phishing, a scam or malware wait here before they can be sent. This is the one place you read a
				client’s email, and only what was flagged. The decision is recorded in the activity log.
			</p>
			{pending.length === 0 ? (
				<p className="flex max-w-3xl items-center gap-2 rounded-xl px-4 py-5 text-sm text-muted-foreground shadow-border animate-enter">
					<ShieldCheck className="size-4 text-emerald-600" />
					Nothing is waiting.
				</p>
			) : (
				<ul className="flex max-w-3xl flex-col gap-4 animate-enter">
					{pending.map((item) => (
						<li key={item.id} className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-border sm:p-5">
							<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
								<span className="font-medium">{item.subject || "(no subject)"}</span>
								<span className="text-xs text-muted-foreground">{formatRelative(item.requestedAt)}</span>
							</div>
							<p className="text-xs text-muted-foreground">
								<Link href={`/platform/workspaces/${item.workspaceId}`} className="underline-offset-2 hover:underline">
									{item.workspaceName}
								</Link>{" "}
								· {item.newsletterName}
							</p>
							<ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">
								{item.reasons.map((reason) => (
									<li key={reason}>{reason}</li>
								))}
							</ul>
							<p className="rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-line text-pretty">
								{toPlainText(item.body).slice(0, EXCERPT_LENGTH)}
								{toPlainText(item.body).length > EXCERPT_LENGTH ? "…" : ""}
							</p>
							<ButtonsReview campaignId={item.id} subject={item.subject} />
						</li>
					))}
				</ul>
			)}
		</>
	);
}
