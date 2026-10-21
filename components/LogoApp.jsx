import { cn } from "@/lib/utils";

export default function LogoApp({ className }) {
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
			<rect width="32" height="32" rx="9" className="fill-foreground" />
			<rect
				x="8"
				y="10"
				width="16"
				height="12"
				rx="2.5"
				fill="none"
				strokeWidth="2"
				className="stroke-background"
			/>
			<path
				d="m9 12 7 5 7-5"
				fill="none"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="stroke-background"
			/>
		</svg>
	);
}
