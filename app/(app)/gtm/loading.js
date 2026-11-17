import HeaderPage from "@/components/HeaderPage";
import { Skeleton } from "@/components/ui/skeleton";

// The step pills, then the shape of a step's form. Widths match the real labels so nothing jumps when the
// page arrives.
const STEP_WIDTHS = ["w-28", "w-24", "w-20", "w-32", "w-24", "w-20"];

export default function Loading() {
	return (
		<>
			<HeaderPage title="GTM agent" icon={<Skeleton className="mr-0.5 size-8 rounded-lg" />} />
			<div aria-hidden="true" className="flex flex-col gap-6">
				<div className="flex flex-wrap items-center gap-1.5">
					{STEP_WIDTHS.map((width, index) => (
						<Skeleton key={index} className={`h-8 rounded-full first:bg-foreground/15 ${width}`} />
					))}
				</div>
				<div className="flex flex-col gap-2">
					<Skeleton className="h-3.5 w-40" />
					<Skeleton className="h-9 rounded-lg" />
					<Skeleton className="h-3 w-72" />
				</div>
				<Skeleton className="h-9 w-32 rounded-lg" />
			</div>
		</>
	);
}
