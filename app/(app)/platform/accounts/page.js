import Link from "next/link";
import { Search, Users } from "lucide-react";
import HeaderPage from "@/components/HeaderPage";
import ListAccounts from "@/components/ListAccounts";
import StateEmpty from "@/components/StateEmpty";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatNumber, formatRelative } from "@/lib/format";
import { ACCOUNTS_PAGE_SIZE, listAccounts } from "@/lib/platform-accounts";

export const metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }) {
	const session = await requirePlatformAdmin();
	const query = String((await searchParams)?.q ?? "").trim().slice(0, 80);
	const { accounts, total } = await listAccounts({ query });

	return (
		<>
			<HeaderPage title="Accounts">
				<form action="/platform/accounts" className="relative">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<input
						name="q"
						defaultValue={query}
						placeholder="Search by email or name"
						aria-label="Search accounts"
						className="h-9 w-60 rounded-lg bg-card pr-3 pl-8 text-sm shadow-border outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
					/>
				</form>
			</HeaderPage>
			<p className="-mt-4 mb-6 max-w-2xl text-sm text-pretty text-muted-foreground animate-enter">
				Everyone who can log in, across every workspace. {formatNumber(total)} {total === 1 ? "account" : "accounts"}
				{query ? ` match “${query}”` : ""}. Workspace owners manage their own people; this is for when someone is locked out or an account must stop.
			</p>
			{accounts.length === 0 ? (
				<StateEmpty icon={Users} title="No accounts found">
					{query && (
						<Link href="/platform/accounts" className="text-sm underline underline-offset-2">
							Clear the search
						</Link>
					)}
				</StateEmpty>
			) : (
				<div className="max-w-3xl animate-enter">
					<ListAccounts
						accounts={accounts.map(({ lastLoginAt, ...account }) => ({ ...account, lastSeen: lastLoginAt ? formatRelative(lastLoginAt) : "Never logged in" }))}
						currentUserId={session.userId}
					/>
					{total > ACCOUNTS_PAGE_SIZE && <p className="mt-3 text-xs text-muted-foreground">Showing the {ACCOUNTS_PAGE_SIZE} most recent. Search to narrow it down.</p>}
				</div>
			)}
		</>
	);
}
