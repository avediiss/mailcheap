// What sending costs on Amazon SES. The price is an estimate: SES bills by the thousand, and the
// real bill also has small items (data transfer, attachments). Override it with SES_PRICE_PER_1000.
export const DEFAULT_PRICE_PER_1000 = 0.1;

export function getPricePer1000(value = process.env.SES_PRICE_PER_1000) {
	const price = Number.parseFloat(value);
	return Number.isFinite(price) && price >= 0 ? price : DEFAULT_PRICE_PER_1000;
}

export function estimateCost(emails, pricePer1000 = DEFAULT_PRICE_PER_1000) {
	const count = Number(emails);
	return Number.isFinite(count) && count > 0 ? (count / 1000) * pricePer1000 : 0;
}

// $0.00 for nothing, and "< $0.01" for a few emails, so a small send doesn't read as free.
export function formatCost(amount) {
	if (!amount) return "$0.00";
	if (amount < 0.01) return "< $0.01";
	return `$${amount.toFixed(2)}`;
}

// Midnight on the 1st of the month in UTC, which is how SES bills.
export function startOfMonth(now = new Date()) {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
