import { Suspense } from "react";
import ChartFrame from "@/components/ChartFrame";
import ChartHover from "@/components/ChartHover";
import { gappedLinePath, niceScale, toRatio } from "@/lib/charts";
import { formatDateKey } from "@/lib/time-zone";

const BOX = { width: 600, height: 160 };

// A rate over time as a line, with the platform's pause limit drawn across it (and the "watch" line at half).
// values are fractions (0.02 = 2%) with null where there isn't enough sending to say.
export default function ChartRate({ days, values, limit, digits = 2, label }) {
	const percents = values.map((value) => (value === null ? null : value * 100));
	const limitPercent = limit * 100;
	const scale = niceScale([0, limitPercent * 1.25, ...percents.filter((value) => value !== null)], 3, limitPercent / 4);
	const xOf = (index) => (days.length > 1 ? index / (days.length - 1) : 0);
	const step = days.length <= 7 ? 1 : days.length <= 30 ? 7 : 14;
	const hasData = percents.some((value) => value !== null);
	const formatPercent = (value) => `${value.toFixed(digits)}%`;

	const points = days.map((day, index) => ({
		x: xOf(index),
		title: formatDateKey(day.key, { weekday: "short", month: "short", day: "numeric" }),
		rows: [
			{ label: label, value: percents[index] === null ? "Too few sends" : formatPercent(percents[index]), swatch: "line" },
			{ label: "Sent", value: day.sent.toLocaleString("en-US") },
		],
		dots: percents[index] === null ? [] : [{ y: toRatio(percents[index], scale), className: "bg-foreground" }],
	}));
	const xLabels = [];
	for (let index = days.length - 1, position = 0; index >= 0; index -= step, position += 1) {
		xLabels.push({ x: xOf(index), label: formatDateKey(days[index].key), className: position % 2 ? "hidden sm:block" : undefined });
	}
	const limitTop = `${(1 - toRatio(limitPercent, scale)) * 100}%`;

	return (
		<ChartFrame scale={scale} xLabels={xLabels} className="h-36 sm:h-40" formatTick={(tick) => `${Number(tick.toFixed(digits))}%`}>
			<div role="img" aria-label={`${label} over ${days.length} days`} className="absolute inset-0">
				<svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
					<path
						d={gappedLinePath(percents, scale, BOX)}
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
						className="text-foreground"
					/>
				</svg>
				<span aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-red-500/70" style={{ top: limitTop }} />
				<span className="absolute right-0 -translate-y-full pb-0.5 text-[10px] font-medium text-red-600 dark:text-red-400" style={{ top: limitTop }}>
					Pause at {formatPercent(limitPercent)}
				</span>
			</div>
			{!hasData && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">Not enough sending to draw a rate yet</p>}
			<Suspense fallback={null}>
				<ChartHover points={points} />
			</Suspense>
		</ChartFrame>
	);
}
