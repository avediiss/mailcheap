import { HEALTH_LABELS } from "@/lib/platform-rules";
import { cn } from "@/lib/utils";

const TONES = { good: "bg-emerald-500", watch: "bg-amber-500", bad: "bg-red-500", unknown: "bg-zinc-400 dark:bg-zinc-500" };

export default function BadgeHealth({ health, className }) {
	return (
		<span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-2 text-xs font-medium whitespace-nowrap text-foreground/80 shadow-border", className)}>
			<span className={cn("size-1.5 rounded-full", TONES[health] ?? TONES.unknown)} />
			{HEALTH_LABELS[health] ?? HEALTH_LABELS.unknown}
		</span>
	);
}
