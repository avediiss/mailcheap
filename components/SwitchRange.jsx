import Link from "next/link";
import { RANGE_OPTIONS } from "@/lib/platform-series";
import { cn } from "@/lib/utils";

// 7 / 30 / 90 days, as links so the choice is in the address and the page stays on the server.
export default function SwitchRange({ range, basePath = "/platform" }) {
	return (
		<div role="group" aria-label="Period" className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
			{RANGE_OPTIONS.map((days) => (
				<Link
					key={days}
					href={`${basePath}?range=${days}`}
					scroll={false}
					aria-current={days === range ? "true" : undefined}
					className={cn("rounded-md px-3 py-1 font-medium tabular-nums transition-colors duration-150", days === range ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
				>
					{days} days
				</Link>
			))}
		</div>
	);
}
