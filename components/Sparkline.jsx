import { areaPath, linePath } from "@/lib/charts";

const BOX = { width: 100, height: 28 };

// A tiny trend line with no axes, for a table row. values: numbers, oldest first.
export default function Sparkline({ values, label, className = "h-7 w-28" }) {
	const max = Math.max(...values, 1);
	const scale = { min: 0, max };
	const total = values.reduce((sum, value) => sum + value, 0);
	return (
		<svg role="img" aria-label={label} viewBox={`0 0 ${BOX.width} ${BOX.height}`} preserveAspectRatio="none" className={`${className} overflow-visible`}>
			{total === 0 ? (
				<line x1="0" x2={BOX.width} y1={BOX.height - 1} y2={BOX.height - 1} stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" className="text-muted-foreground/40" />
			) : (
				<>
					<path d={areaPath(values, scale, BOX)} fill="currentColor" className="text-foreground/10" />
					<path d={linePath(values, scale, BOX)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="text-foreground" />
				</>
			)}
		</svg>
	);
}
