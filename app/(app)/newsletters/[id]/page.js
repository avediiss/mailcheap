import { Types, isValidObjectId } from "mongoose";
import { notFound } from "next/navigation";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import FormNewsletter from "@/components/FormNewsletter";
import HeaderPage from "@/components/HeaderPage";
import { cleanupTotalsPipeline } from "@/lib/cleanup";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { listWorkspaceDomains, requireWorkspace } from "@/lib/workspace";
import { filterDomainsForWorkspace } from "@/lib/workspace-rules";
import { serialize } from "@/lib/serialize";
import { listSesDomains } from "@/lib/ses";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Newsletter" };

export default async function NewsletterPage({ params }) {
	const { id } = await params;
	const isNew = id === "new";
	if (!isNew && !isValidObjectId(id)) notFound();

	const { workspaceId, session } = await requireWorkspace();
	await connectDb();
	// Found only inside the signed-in person's workspace: another workspace's id is a 404, not a peek.
	const [newsletter, domains, ownDomains] = await Promise.all([
		isNew ? null : Newsletter.findOne({ _id: id, workspaceId }).lean(),
		listSesDomains(),
		listWorkspaceDomains(workspaceId),
	]);
	if (!isNew && !newsletter) notFound();
	const cleanupTotals = isNew ? null : await getCleanupTotals(workspaceId, id);

	const verifiedDomains = Array.isArray(domains)
		? filterDomainsForWorkspace(domains, ownDomains)
				.filter(({ verified }) => verified)
				.map(({ domain }) => domain)
		: null;

	return (
		<>
			<HeaderPage
				title={isNew ? "New newsletter" : newsletter.name}
				backHref="/newsletters"
				icon={newsletter && <AvatarNewsletter newsletter={newsletter} size={32} />}
			/>
			<FormNewsletter
				newsletter={newsletter ? serialize(newsletter) : null}
				verifiedDomains={verifiedDomains}
				isSendingEnabled={isSendingEnabled()}
				testEmail={session.email}
				cleanupTotals={cleanupTotals}
				appHost={new URL(getAppUrl()).hostname}
			/>
		</>
	);
}

async function getCleanupTotals(workspaceId, newsletterId) {
	const [totals] = await Contact.aggregate(cleanupTotalsPipeline(new Types.ObjectId(newsletterId), workspaceId));
	return { waiting: totals?.waiting ?? 0, kept: totals?.kept ?? 0, dormant: totals?.dormant ?? 0 };
}
