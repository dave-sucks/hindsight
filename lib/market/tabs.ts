/**
 * The Market page's four tabs — the list itself, not the component.
 *
 * Its own module because BOTH sides need it: the server page reads it to
 * resolve `?tab=`, and the client component renders from it. Exported from
 * the client component instead, a server import got the client-reference
 * proxy rather than the array, and `/market` died at request time with
 * "MARKET_TABS.find is not a function" — green through tsc (the types are
 * right) and green through `next build` (the page is dynamic, so it is never
 * rendered at build).
 *
 * The rule this encodes: a server component may import COMPONENTS from a
 * "use client" module. Anything else — an array, a map, a helper — belongs in
 * a plain module both can import.
 */
export type MarketTab = "earnings" | "filings" | "movers" | "signals";

export const MARKET_TABS: Array<{ value: MarketTab; label: string; blurb: string }> = [
  { value: "earnings", label: "Earnings", blurb: "Who reports this week, and how it went. Your names first." },
  { value: "filings", label: "Filings", blurb: "This week's SEC filings for the names you follow." },
  { value: "movers", label: "Movers", blurb: "Today's biggest gainers, losers and most-traded stocks." },
  { value: "signals", label: "Signals", blurb: "What the retired monitors found. Read-only." },
];

/** The tab a `?tab=` value names, or Earnings when it names nothing we have. */
export function marketTabFromParam(tab: string | undefined): MarketTab {
  return MARKET_TABS.find((t) => t.value === tab)?.value ?? "earnings";
}
