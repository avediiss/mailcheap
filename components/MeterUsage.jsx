import { formatLimit } from "@/lib/platform-rules";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const BAR_TONES = { ok: "bg-foreground/70", near: "bg-amber-500", full: "bg-red-500", unlimited: "bg-muted-foreground/30" };

// "1,240 of 5,000" with a bar. Without a limit it just says how many, and "no limit".
export default function MeterUsage({ label, meter, compact = false }) {
	const isUnlimited = meter.state === "unlimited";
	return (
		<div className={cn("flex flex-col", compact ? "gap-1" : "gap-1.5")}>
			<div className="flex items-baseline justify-between gap-3 text-sm">
				{label && <span className="text-muted-foreground">{label}</span>}
				<span className="tabular-nums">
					<span className="font-medium">{formatNumber(meter.used)}</span>
					<span className="text-muted-foreground"> {isUnlimited ? "· no limit" : `of ${formatLimit(meter.limit)}`}</span>
				</span>
			</div>
			<div
				role="progressbar"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={isUnlimited ? undefined : meter.limit}
				aria-valuenow={meter.used}
				className="h-1.5 overflow-hidden rounded-full bg-muted"
			>
				<div className={cn("h-full rounded-full transition-[width] duration-500", BAR_TONES[meter.state])} style={{ width: isUnlimited ? "0%" : `${Math.max(meter.ratio * 100, meter.used > 0 ? 2 : 0)}%` }} />
			</div>
			{meter.state === "full" && <p className="text-xs text-red-600 dark:text-red-400">Limit reached</p>}
			{meter.state === "near" && <p className="text-xs text-amber-600 dark:text-amber-400">Close to the limit</p>}
		</div>
	);
}
