// A titled card for a chart: the title and what it shows on the left, a headline number on the right.
export default function CardChart({ title, hint, value, children }) {
	return (
		<section className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-border sm:p-5">
			<header className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-0.5">
					<h2 className="text-sm font-medium">{title}</h2>
					{hint && <p className="text-xs text-pretty text-muted-foreground">{hint}</p>}
				</div>
				{value && <span className="shrink-0 text-right text-lg font-semibold tracking-tight tabular-nums">{value}</span>}
			</header>
			{children}
		</section>
	);
}
