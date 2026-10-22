import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import FormLoginVerify from "@/components/FormLoginVerify";
import LogoApp from "@/components/LogoApp";
import { getSession } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { CHALLENGE_COOKIE, verifyChallengeToken } from "@/lib/session-token";

export const metadata = { title: "Second step" };

export default async function LoginVerifyPage() {
	if (await getSession()) redirect("/");
	// Without the first step done, there is nothing to verify.
	if (!(await verifyChallengeToken((await cookies()).get(CHALLENGE_COOKIE)?.value))) redirect("/login");

	return (
		<main className="flex min-h-dvh items-center justify-center px-4">
			<div className="w-full max-w-xs">
				<div className="mb-8 flex flex-col items-center gap-3 text-center">
					<LogoApp className="size-10" />
					<h1 className="text-lg font-semibold tracking-tight">Check your authenticator</h1>
					<p className="text-sm text-pretty text-muted-foreground">Enter the 6-digit code from your app to log in to {APP_NAME}.</p>
				</div>
				<FormLoginVerify />
			</div>
		</main>
	);
}
