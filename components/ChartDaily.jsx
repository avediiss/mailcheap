import { Suspense } from "react";
import ChartFrame from "@/components/ChartFrame";
import ChartHover from "@/components/ChartHover";
import { SERIES_BG, seriesPaletteIndex } from "@/lib/chart-colors";
import { niceScale, toRatio } from "@/lib/charts";
import { formatNumber } from "@/lib/format";
import { OTHERS_ID } from "@/lib/platform-series";
import { formatDateKey } from "@/lib/time-zone";
import { cn } from "@/lib/utils";

// Emails sent each day as bars, stacked by workspace (the biggest few, the rest as Others). A chart of one
// workspace passes a single series. Hovering a day lists who sent what.
export default function ChartDaily({ stack, className = "h-48 sm:h-56", labelEvery }) {
	const { series, days } = stack;
	const palette = series.map(({ id }, position) => seriesPaletteIndex(position, { isOthers: id === OTHERS_ID }));
	const scale = niceScale([0, ...days.map(({ total }) => total)], 4);
	const xOf = (index) => (index + 0.5) / days.length;
	const step = labelEvery ?? (days.length <= 7 ? 1 : days.length <= 30 ? 7 : 14);
	const sentTotal = days.reduce((sum, { total }) => sum + total, 0);

	const points = days.map((day, index) => ({
		x: xOf(index),
		title: formatDateKey(day.key, { weekday: "short", month: "short", day: "numeric" }),
		rows: [
			...series.map(({ name }, position) => ({ label: name, value: formatNumber(day.parts[position]), swatch: `series-${palette[position]}` })).filter((_, position) => day.parts[position] > 0),
			series.length > 1 && { label: "Total", value: formatNumber(day.total) },
			day.total === 0 && { label: "Sent", value: "0" },
		].filter(Boolean),
	}));
	const xLabels = [];
	for (let index = days.length - 1, position = 0; index >= 0; index -= step, position += 1) {
		xLabels.push({ x: xOf(index), label: formatDateKey(days[index].key), className: position % 2 ? "hidden sm:block" : undefined });
	}

	return (
		<div className="flex flex-col gap-4">
			<ChartFrame scale={scale} xLabels={xLabels} className={className}>
				<div role="img" aria-label={`${formatNumber(sentTotal)} emails sent over ${days.length} days`} className="absolute inset-0 flex items-end gap-px sm:gap-[3px]">
					{days.map((day) => (
						<div key={day.key} className="relative flex h-full flex-1 flex-col-reverse justify-start">
							{day.parts.map((count, position) =>
								count > 0 ? (
									<span
										key={series[position].id}
										className={cn(SERIES_BG[palette[position]], "w-full shrink-0 last:rounded-t-[3px]")}
										style={{ height: `${toRatio(count, scale) * 100}%`, minHeight: 2 }}
									/>
								) : null
							)}
						</div>
					))}
				</div>
				{sentTotal === 0 && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">No emails sent in this period</p>}
				<Suspense fallback={null}>
					<ChartHover points={points} band={1 / days.length} />
				</Suspense>
			</ChartFrame>
			{series.length > 1 && (
				<ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
					{series.map(({ id, name }, position) => (
						<li key={id} className="flex items-center gap-1.5">
							<span aria-hidden="true" className={cn("size-2 rounded-[2px]", SERIES_BG[palette[position]])} />
							{name}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
