import { Gauge } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { WARMUP_DAYS } from "@/lib/send-plan";
import { loadSendState } from "@/lib/send-plan-server";

// A new sender's daily amount, in words: where the warm-up is and what is left today. Nothing for a trusted
// workspace or one that is past its first month and nowhere near its allowance.
export default async function CardSending({ workspaceId }) {
	const state = await loadSendState(workspaceId);
	if (state.isTrusted || !Number.isFinite(state.cap)) return null;
	const isWarmingUp = state.warmupDay <= WARMUP_DAYS;
	const left = Math.max(0, state.cap - state.sentToday);
	const isNearCap = state.sentToday >= state.cap * 0.8;
	if (!isWarmingUp && !isNearCap) return null;

	return (
		<div className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-border animate-enter sm:p-5">
			<Gauge className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
			<div className="flex flex-col gap-1 text-sm text-pretty">
				<p className="font-medium">
					{isWarmingUp ? `Your sending is building up: day ${state.warmupDay} of ${WARMUP_DAYS}` : "You're close to today's sending allowance"}
				</p>
				<p className="text-muted-foreground">
					You can send {formatNumber(state.cap)} emails a day, and {formatNumber(left)} {left === 1 ? "is" : "are"} left today.
					{isWarmingUp && !state.isWatch && " The amount doubles every three days while your emails land well."}
					{state.isWatch && " Some of your emails bounced or were marked as spam, so the amount isn't growing until that settles."}
					{" "}A bigger send is spread over the next days, most engaged contacts first.
				</p>
			</div>
		</div>
	);
}
