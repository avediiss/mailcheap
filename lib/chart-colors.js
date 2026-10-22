// The colours of a chart that stacks several series (one per workspace), in order. The last is for "Others".
// Full class names, so Tailwind finds them.
export const SERIES_BG = ["bg-foreground", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-muted-foreground/40"];

// Which colour the nth series gets: "Others" (when present it is always last) takes the grey one.
export function seriesPaletteIndex(position, { isOthers = false } = {}) {
	return isOthers ? SERIES_BG.length - 1 : position % (SERIES_BG.length - 1);
}
