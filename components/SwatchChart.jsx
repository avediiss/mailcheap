import { SERIES_BG } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

// The mark of a series, for legends and tooltips.
export default function SwatchChart({ kind }) {
	// "series-2": the third colour of a chart that stacks several.
	const series = /^series-(\d+)$/.exec(kind);
	const className = series ? cn("size-2 rounded-[2px]", SERIES_BG[Number(series[1])]) : SWATCHES[kind];
	return <span aria-hidden="true" className={cn("inline-block shrink-0", className)} />;
}

const SWATCHES = {
	line: "h-0.5 w-3 rounded-full bg-foreground",
	dashed:
		"h-0.5 w-[15px] bg-[repeating-linear-gradient(90deg,var(--color-muted-foreground)_0_3px,transparent_3px_6px)] opacity-70",
	bar: "size-2 rounded-[2px] bg-foreground",
	ghost: "size-2 rounded-[2px] bg-muted-foreground/25",
};
