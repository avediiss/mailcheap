import { TriangleAlert } from "lucide-react";

export default function BannerSuspended({ workspaceName }) {
	return (
		<div role="status" className="mb-6 flex items-start gap-3 rounded-xl bg-amber-500/10 px-4 py-3 text-sm shadow-border animate-enter">
			<TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
			<p className="text-pretty">
				<span className="font-medium">{workspaceName} is suspended.</span>{" "}
				<span className="text-muted-foreground">
					You can look around, but sending, new signups and the API are paused. Contact the platform owner to turn it back on.
				</span>
			</p>
		</div>
	);
}
