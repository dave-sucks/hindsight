/**
 * What the betting market gives the next Fed decision: Polymarket's
 * "Fed Decision in <Month>?" event, one market per outcome, each priced as
 * the chance of yes. Public, no key. Read live: odds move, so no cache.
 */

const SEARCH = "https://gamma-api.polymarket.com/public-search?q=fed%20decision&limit_per_type=10";

export interface FedOdds {
  /** Polymarket's title: "Fed Decision in December?". */
  title: string;
  /** When the market settles, ISO. */
  settles: string;
  /** Each outcome's chance, 0 to 1, likeliest first. Outcomes under 2% are left out. */
  odds: { outcome: string; chance: number }[];
  url: string;
}

interface PolyMarket {
  groupItemTitle?: string;
  question?: string;
  outcomePrices?: string | string[];
  closed?: boolean;
}

interface PolyEvent {
  title?: string;
  endDate?: string;
  closed?: boolean;
  slug?: string;
  markets?: PolyMarket[];
}

/** The chance of yes: the first price. Polymarket sends the list as a JSON string. */
function yesChance(prices: PolyMarket["outcomePrices"]): number | null {
  let list: unknown = prices;
  if (typeof prices === "string") {
    try {
      list = JSON.parse(prices);
    } catch {
      return null;
    }
  }
  const yes = Array.isArray(list) ? Number(list[0]) : NaN;
  return Number.isFinite(yes) ? yes : null;
}

/** The open Fed-decision event that settles next. */
export function pickNextFedOdds(raw: unknown, now: Date): FedOdds | null {
  const events = ((raw as { events?: PolyEvent[] } | null)?.events ?? []).filter(
    (e) => !e.closed && /fed decision/i.test(e.title ?? "") && Date.parse(e.endDate ?? "") > now.getTime(),
  );
  const next = events.sort((a, b) => Date.parse(a.endDate!) - Date.parse(b.endDate!))[0];
  if (!next) return null;
  const odds = (next.markets ?? [])
    .filter((m) => !m.closed)
    .map((m) => ({ outcome: (m.groupItemTitle || m.question || "").trim(), chance: yesChance(m.outcomePrices) }))
    .filter((o): o is { outcome: string; chance: number } => o.outcome !== "" && o.chance != null && o.chance >= 0.02)
    .sort((a, b) => b.chance - a.chance);
  if (odds.length === 0) return null;
  return { title: next.title!, settles: next.endDate!, odds, url: `https://polymarket.com/event/${next.slug ?? ""}` };
}

export async function loadNextFedOdds(now: Date): Promise<{ odds: FedOdds | null; error?: string }> {
  try {
    const res = await fetch(SEARCH, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return { odds: null, error: `Polymarket answered ${res.status}` };
    const odds = pickNextFedOdds(await res.json(), now);
    return odds ? { odds } : { odds: null, error: "Polymarket lists no open market on the next Fed decision" };
  } catch (err) {
    return { odds: null, error: err instanceof Error ? `Polymarket: ${err.message}` : "Polymarket did not answer" };
  }
}

/** "25 bps increase 79%, No change 21%". */
export function oddsLine(odds: FedOdds): string {
  return odds.odds.map((o) => `${o.outcome} ${Math.round(o.chance * 100)}%`).join(", ");
}
