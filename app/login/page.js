import { redirect } from "next/navigation";
import FormLogin from "@/components/FormLogin";
import LogoApp from "@/components/LogoApp";
import { getSession } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }) {
	if (await getSession()) redirect("/");
	const { next } = await searchParams;

	return (
		<main className="flex min-h-dvh items-center justify-center px-4">
			<div className="w-full max-w-xs">
				<div className="mb-8 flex flex-col items-center gap-3 text-center">
					<LogoApp className="size-10" />
					<h1 className="text-lg font-semibold tracking-tight">Log in to {APP_NAME}</h1>
				</div>
				<FormLogin next={typeof next === "string" ? next : "/"} />
			</div>
		</main>
	);
}
