import crypto from "node:crypto";
import { isValidObjectId } from "mongoose";
import { notFound } from "next/navigation";
import AvatarContact from "@/components/AvatarContact";
import BadgeStatus from "@/components/BadgeStatus";
import HeaderPage from "@/components/HeaderPage";
import MenuContact from "@/components/MenuContact";
import { buildActivity, EVENT_VERBS, getEngagement } from "@/lib/contact-activity";
import { formatFieldValue } from "@/lib/contact-fields";
import { listContactFields } from "@/lib/contact-fields-server";
import { connectDb } from "@/lib/db";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Contact" };

const EVENT_TONES = {
	opened: "bg-emerald-500",
	clicked: "bg-emerald-500",
	delivered: "bg-sky-500",
	sent: "bg-sky-500",
	subscribed: "bg-foreground",
	confirmed: "bg-foreground",
	left: "bg-zinc-400",
	bounced: "bg-red-500",
	complained: "bg-red-500",
	failed: "bg-red-500",
};

function percent(rate) {
	return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

export default async function ContactPage({ params }) {
	const { id } = await params;
	if (!isValidObjectId(id)) notFound();
	const { workspaceId } = await requireWorkspace();

	await connectDb();
	// Found only inside the signed-in person's workspace: another workspace's contact is a 404.
	const contact = await Contact.findOne({ _id: id, workspaceId }).lean();
	if (!contact) notFound();
	const [newsletter, fieldDefs, messages] = await Promise.all([
		Newsletter.findOne({ _id: contact.newsletterId, workspaceId }).select({ name: 1 }).lean(),
		listContactFields(workspaceId),
		Message.find({ contactId: contact._id, workspaceId, kind: { $ne: "test" } }).sort({ createdAt: -1 }).limit(80).lean(),
	]);
	const campaigns = await Campaign.find({ _id: { $in: messages.map(({ campaignId }) => campaignId).filter(Boolean) }, workspaceId }).select({ subject: 1 }).lean();
	const campaignSubjects = new Map(campaigns.map(({ _id, subject }) => [String(_id), subject]));
	const activity = buildActivity({ contact, messages, campaignSubjects });
	const engagement = getEngagement(contact.stats);
	const gravatarHash = crypto.createHash("sha256").update(contact.email.trim().toLowerCase()).digest("hex");

	const details = [
		["Newsletter", newsletter?.name],
		["First name", contact.firstName],
		["Source", contact.source],
		["Joined", formatDate(contact.subscribedAt)],
		["Confirmed", contact.confirmedAt && formatDate(contact.confirmedAt)],
		["Left", contact.unsubscribedAt && formatDate(contact.unsubscribedAt)],
		["Last email", contact.lastSentAt && formatRelative(contact.lastSentAt)],
		["Last open", contact.lastOpenAt && formatRelative(contact.lastOpenAt)],
		["Last click", contact.lastClickAt && formatRelative(contact.lastClickAt)],
	].filter(([, value]) => value);

	return (
		<>
			<HeaderPage
				title={contact.email}
				backHref="/contacts"
				icon={<AvatarContact email={contact.email} gravatarHash={gravatarHash} size={32} />}
				meta={<BadgeStatus status={contact.status} />}
			>
				<MenuContact
					id={String(contact._id)}
					email={contact.email}
					status={contact.status}
					firstName={contact.firstName}
					tags={contact.tags ?? []}
					fieldDefs={fieldDefs}
					fieldValues={contact.fields ?? {}}
				/>
			</HeaderPage>

			<div className="flex max-w-3xl flex-col gap-8">
				<div style={{ "--stagger": 0 }} className="grid grid-cols-3 gap-3 animate-enter">
					{[
						["Emails sent", formatNumber(engagement.sent), null],
						["Opened", formatNumber(engagement.opens), percent(engagement.openRate)],
						["Clicked", formatNumber(engagement.clicks), percent(engagement.clickRate)],
					].map(([label, value, rate]) => (
						<div key={label} className="flex flex-col gap-1 rounded-xl bg-card p-4 shadow-border">
							<span className="text-[13px] text-muted-foreground">{label}</span>
							<span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
							{rate && <span className="text-xs text-muted-foreground tabular-nums">{rate} of emails sent</span>}
						</div>
					))}
				</div>

				<section style={{ "--stagger": 1 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Details</h2>
					<div className="overflow-hidden rounded-xl bg-card shadow-border">
						<dl className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2">
							{details.map(([label, value]) => (
								<div key={label} className="flex items-baseline justify-between gap-4 bg-card px-4 py-2.5 text-sm">
									<dt className="text-muted-foreground">{label}</dt>
									<dd className="truncate font-medium tabular-nums">{value}</dd>
								</div>
							))}
							{contact.tags?.length > 0 && (
								<div className="flex flex-wrap items-center justify-between gap-2 bg-card px-4 py-2.5 text-sm sm:col-span-2">
									<dt className="text-muted-foreground">Tags</dt>
									<dd className="flex flex-wrap gap-1">
										{contact.tags.map((tag) => (
											<span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
												{tag}
											</span>
										))}
									</dd>
								</div>
							)}
							{contact.imported?.openRate !== undefined && contact.imported?.openRate !== null && (
								<div className="flex items-baseline justify-between gap-4 bg-card px-4 py-2.5 text-sm sm:col-span-2">
									<dt className="text-muted-foreground">From their previous platform</dt>
									<dd className="font-medium tabular-nums">
										{percent(contact.imported.openRate)} opens
										{contact.imported.clickRate !== undefined && contact.imported.clickRate !== null && ` · ${percent(contact.imported.clickRate)} clicks`}
									</dd>
								</div>
							)}
						</dl>
					</div>
				</section>

				{fieldDefs.length > 0 && (
					<section style={{ "--stagger": 2 }} className="flex flex-col gap-3 animate-enter">
						<h2 className="text-sm font-medium text-muted-foreground">Fields</h2>
						<div className="overflow-hidden rounded-xl bg-card shadow-border">
							<dl className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2">
								{fieldDefs.map(({ key, label }) => (
									<div key={key} className="flex items-baseline justify-between gap-4 bg-card px-4 py-2.5 text-sm">
										<dt className="text-muted-foreground">{label}</dt>
										<dd className="truncate font-medium">{formatFieldValue(contact.fields?.[key]) || <span className="text-muted-foreground">—</span>}</dd>
									</div>
								))}
							</dl>
						</div>
					</section>
				)}

				<section style={{ "--stagger": 3 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Activity</h2>
					{activity.length === 0 ? (
						<p className="rounded-xl px-4 py-5 text-sm text-muted-foreground shadow-border">Nothing yet.</p>
					) : (
						<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
							{activity.map((event, index) => (
								<li key={`${event.type}-${event.messageId ?? "c"}-${index}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
									<span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", EVENT_TONES[event.type] ?? "bg-zinc-400")} />
									<span className="min-w-0 flex-1 truncate">
										<span className="font-medium">{EVENT_VERBS[event.type]}</span>{" "}
										<span className="text-muted-foreground">{event.title}</span>
										{event.detail && <span className="text-muted-foreground"> · {event.detail}</span>}
									</span>
									<time dateTime={new Date(event.at).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
										{formatRelative(event.at)}
									</time>
								</li>
							))}
						</ul>
					)}
					<p className="text-xs text-muted-foreground">Opens are estimates: some mail apps open emails on their own.</p>
				</section>
			</div>
		</>
	);
}
