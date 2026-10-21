import { redirect } from "next/navigation";
import FormForgotPassword from "@/components/FormForgotPassword";
import LogoMailcheap from "@/components/LogoMailcheap";
import { getSession } from "@/lib/auth";

export const metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage() {
	if (await getSession()) redirect("/");

	return (
		<main className="flex min-h-dvh items-center justify-center px-4">
			<div className="w-full max-w-xs">
				<div className="mb-8 flex flex-col items-center gap-3 text-center">
					<LogoMailcheap className="size-10" />
					<h1 className="text-lg font-semibold tracking-tight">Reset your password</h1>
					<p className="text-sm text-muted-foreground">We’ll email you a link to choose a new one.</p>
				</div>
				<FormForgotPassword />
			</div>
		</main>
	);
}
