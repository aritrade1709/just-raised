import type { Currency } from "./types.ts";

// Approximate spot rates, used only to sort and total. Amounts are always
// displayed in the currency the headline reported.
export const INR_PER_USD = 88;
const USD_PER: Record<Currency, number> = {
  USD: 1,
  INR: 1 / INR_PER_USD,
  EUR: 1.1,
  GBP: 1.3,
  SGD: 0.75,
  AED: 0.27,
  JPY: 0.0067,
};

export function toUsd(amount: number, currency: Currency): number {
  return amount * USD_PER[currency];
}

/** "$24M", "₹532 Cr", "€4.3M", "$1.2B". */
export function formatAmount(amount: number | null, currency: Currency | null): string {
  if (amount === null || currency === null) return "Undisclosed";
  if (currency === "INR") {
    const cr = amount / 1e7;
    if (cr >= 1) return `₹${trim(cr)} Cr`;
    return `₹${trim(amount / 1e5)} L`;
  }
  const sym: Record<Currency, string> = { USD: "$", INR: "₹", EUR: "€", GBP: "£", SGD: "S$", AED: "AED ", JPY: "¥" };
  if (amount >= 1e9) return `${sym[currency]}${trim(amount / 1e9)}B`;
  if (amount >= 1e6) return `${sym[currency]}${trim(amount / 1e6)}M`;
  if (amount >= 1e3) return `${sym[currency]}${trim(amount / 1e3)}K`;
  return `${sym[currency]}${trim(amount)}`;
}

/** Total in USD → "$1.2B" / "$840M". */
export function formatUsdTotal(usd: number): string {
  if (usd >= 1e9) return `$${trim(usd / 1e9)}B`;
  if (usd >= 1e6) return `$${Math.round(usd / 1e6)}M`;
  return `$${trim(usd / 1e3)}K`;
}

function trim(n: number): string {
  const s = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
