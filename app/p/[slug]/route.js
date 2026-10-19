import { getArchiveUrls } from "@/lib/archive-hosts";
import { getAppUrl } from "@/lib/config";
import { connectDb } from "@/lib/db";
import Campaign from "@/models/Campaign";
import Newsletter from "@/models/Newsletter";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;

// Archive domains rewrite /p/slug in proxy.js; on the app's domain the link doesn't name the newsletter.
export async function GET(request, { params }) {
	const { slug } = await params;
	if (!SLUG_PATTERN.test(slug)) return new Response("Not found", { status: 404 });

	await connectDb();
	const campaign = await Campaign.findOne({ archiveSlug: slug }).select("newsletterId").lean();
	const newsletter =
		campaign && (await Newsletter.findOne({ _id: campaign.newsletterId, archiveEnabled: true }).select("slug archiveHost").lean());
	if (!newsletter) return new Response("Not found", { status: 404 });

	// APP_URL, not request.url: behind a reverse proxy the request URL is the server's internal address.
	return Response.redirect(new URL(getArchiveUrls(newsletter).post(slug), getAppUrl()), 307);
}
