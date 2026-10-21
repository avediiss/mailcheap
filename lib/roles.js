// owner: manages members, domains and API keys. editor: newsletters, campaigns and contacts.
// Its own file so browser code can know the roles without pulling in the database models.
export const ROLES = ["owner", "editor"];

export function roleLabel(role) {
	return role === "owner" ? "Owner" : "Editor";
}

export function describeRole(role) {
	return role === "owner"
		? "Manages members, domains and API keys, and can do everything an editor can."
		: "Works on newsletters, campaigns and contacts.";
}
