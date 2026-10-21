import { cn } from "@/lib/utils";

// Two letters on a colour taken from the name, so the same workspace or person always looks the same.
function hueOf(text) {
	let hash = 0;
	for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
	return hash;
}

export function getInitials(name) {
	// Words that start with a letter or digit: "Avedis (platform owner)" is A and P, not A and "(".
	const words = String(name ?? "").split(/\s+/).map((word) => word.replace(/^[^\p{L}\p{N}]+/u, "")).filter(Boolean);
	if (words.length === 0) return "?";
	const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
	return letters.toUpperCase();
}

export default function AvatarInitials({ name, size = 28, shape = "round", className }) {
	const hue = hueOf(String(name ?? ""));
	return (
		<span
			aria-hidden
			style={{
				width: size,
				height: size,
				fontSize: Math.round(size * 0.4),
				backgroundImage: `linear-gradient(135deg, oklch(0.78 0.11 ${hue}), oklch(0.62 0.14 ${hue + 40}))`,
			}}
			className={cn(
				"grid shrink-0 place-items-center font-semibold text-white outline -outline-offset-1 outline-black/5 dark:outline-white/10",
				shape === "round" ? "rounded-full" : "rounded-lg",
				className
			)}
		>
			{getInitials(name)}
		</span>
	);
}
