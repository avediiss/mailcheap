import FormResetPassword from "@/components/FormResetPassword";
import LogoMailcheap from "@/components/LogoMailcheap";
import { looksLikeResetToken } from "@/lib/session-rules";

export const metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }) {
	const { token } = await searchParams;

	return (
		<main className="flex min-h-dvh items-center justify-center px-4">
			<div className="w-full max-w-xs">
				<div className="mb-8 flex flex-col items-center gap-3 text-center">
					<LogoMailcheap className="size-10" />
					<h1 className="text-lg font-semibold tracking-tight">Choose a new password</h1>
				</div>
				<FormResetPassword token={looksLikeResetToken(token) ? token : ""} />
			</div>
		</main>
	);
}
