import { Input } from "@/components/ui/input";
import { LIMIT_FIELDS } from "@/lib/platform-rules";

// The three limits as inputs. Empty means no limit.
export default function FieldsLimits({ values = {} }) {
	return (
		<div className="flex flex-col gap-3">
			{LIMIT_FIELDS.map(({ key, label, hint }) => (
				<label key={key} className="grid gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center sm:gap-4">
					<span className="flex flex-col">
						<span className="text-sm font-medium">{label}</span>
						<span className="text-xs text-muted-foreground">{hint}</span>
					</span>
					<Input name={key} inputMode="numeric" defaultValue={values[key] ?? ""} placeholder="No limit" autoComplete="off" className="tabular-nums" />
				</label>
			))}
		</div>
	);
}
