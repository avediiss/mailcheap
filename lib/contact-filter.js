import { Types, isValidObjectId } from "mongoose";
import { CONTACT_STATUSES } from "../models/Contact.js";

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The contacts page and the CSV export read the same filters from the address: ?newsletter=&status=&q=
export function readContactFilters(params) {
	const get = (key) => (typeof params?.get === "function" ? params.get(key) : params?.[key]);
	const newsletter = get("newsletter");
	const status = get("status");
	const query = get("q");
	return {
		newsletterId: isValidObjectId(newsletter) ? String(newsletter) : null,
		status: CONTACT_STATUSES.includes(status) ? status : null,
		query: typeof query === "string" ? query.trim().toLowerCase().slice(0, 254) : "",
	};
}

// baseFilter: without the status, for the per-status counts. filter: with it.
export function buildContactFilters({ newsletterId, status, query }) {
	const baseFilter = {
		...(newsletterId && { newsletterId: new Types.ObjectId(newsletterId) }),
		...(query && { email: { $regex: `^${escapeRegex(query)}` } }),
	};
	return { baseFilter, filter: { ...baseFilter, ...(status && { status }) } };
}
