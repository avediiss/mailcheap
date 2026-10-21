import MeterUsage from "@/components/MeterUsage";
import { LIMIT_FIELDS } from "@/lib/platform-rules";

// A workspace's own allowance, shown to its people when the platform owner has set limits. Nothing at all
// without limits: no one needs to see "no limit" three times.
export default function CardUsage({ usage }) {
	const rows = LIMIT_FIELDS.filter(({ key }) => usage.limits[key] !== null);
	if (rows.length === 0) return null;
	return (
		<div className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-border animate-fade-in sm:p-5">
			{rows.map(({ key, label }) => (
				<MeterUsage key={key} label={label} meter={usage.meters[key]} />
			))}
			<p className="text-xs text-muted-foreground">Emails count each month. To raise a limit, ask whoever runs this platform.</p>
		</div>
	);
}
