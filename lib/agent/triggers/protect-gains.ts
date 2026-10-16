/**
 * Protect gains — the owner's account setting: once a holding is up, it never
 * goes back below its buy price.
 *
 * It raises the stock's own floor, the one on its chart. Once the high is
 * `startPct` over the buy price, the floor is held at max(buy price,
 * high × (1 − giveBackPct)) for a long (mirrored for a short), raised as the
 * high rises and never lowered. The floor is the stock's automatic sale, so
 * the existing floor sale does the selling. Agents can't lower a floor, and a
 * stock's own floor beats any analyst or account rule.
 *
 * Pure and client-safe. The trigger check raises the high and the floor
 * (trigger-evaluator.ts → protect-gains-floor.ts).
 */

export interface ProtectGains {
  startPct: number;
  giveBackPct: number;
  /** "NOW": the high counts from when the rule was turned on. "BUY": from each stock's buy (its tracked high). */
  from: "NOW" | "BUY";
}

/** The account columns this rule reads, for a Prisma `select`. */
export const PROTECT_GAINS_SELECT = { protectGainsOn: true, protectGainsStartPct: true, protectGainsGiveBackPct: true, protectGainsFrom: true } as const;

/** The account's settings, or null while the rule is off. */
export function protectGainsOf(
  a: { protectGainsOn?: boolean | null; protectGainsStartPct?: number | null; protectGainsGiveBackPct?: number | null; protectGainsFrom?: string | null } | null | undefined,
): ProtectGains | null {
  if (a?.protectGainsOn !== true) return null;
  return { startPct: a.protectGainsStartPct ?? 3, giveBackPct: a.protectGainsGiveBackPct ?? 5, from: a.protectGainsFrom === "BUY" ? "BUY" : "NOW" };
}

type Held = { avgCost: number; isLong: boolean };

/**
 * The high after this check: the stored one raised by a fresh price, or, with
 * none stored yet, started — from the tracked high since the buy ("BUY") or
 * from this price ("NOW"). A stale or missing price never raises it.
 */
export function nextProtectHigh(
  p: { protectHigh: number | null; peakPrice: number | null; isLong: boolean },
  price: number | null,
  fresh: boolean,
  s: ProtectGains,
): number | null {
  const start = p.protectHigh ?? (s.from === "BUY" ? p.peakPrice : null);
  if (price == null || !(price > 0) || !fresh) return start;
  if (start == null) return price;
  return p.isLong ? Math.max(start, price) : Math.min(start, price);
}

/** The buy price to the cent, on its safe side, so the floor never sits a fraction under it. */
const buyCents = (h: Held) => (h.isLong ? Math.ceil(h.avgCost * 100 - 1e-6) / 100 : Math.floor(h.avgCost * 100 + 1e-6) / 100);

/** Where the floor is held, or null until the high has run `startPct` past the buy price. */
export function protectLine(h: Held, high: number | null, s: ProtectGains): number | null {
  if (high == null || !(high > 0) || !(h.avgCost > 0)) return null;
  const armed = h.isLong ? high >= h.avgCost * (1 + s.startPct / 100) : high <= h.avgCost * (1 - s.startPct / 100);
  if (!armed) return null;
  const giveBack = h.isLong ? Math.ceil(high * (100 - s.giveBackPct) - 1e-6) / 100 : Math.floor(high * (100 + s.giveBackPct) + 1e-6) / 100;
  return h.isLong ? Math.max(buyCents(h), giveBack) : Math.min(buyCents(h), giveBack);
}

/**
 * Whether the floor moves up to the line on this pass: in steps of at least 1%,
 * so a stock making new highs isn't rewritten on every check, except the raise
 * that first brings a floor under the buy price up to it.
 */
export function floorDue(h: Held, floor: number | null, line: number): boolean {
  if (floor == null) return true;
  if (h.isLong) return floor < buyCents(h) ? line > floor : line >= floor * 1.01;
  return floor > buyCents(h) ? line < floor : line <= floor * 0.99;
}

/** The price is at or through the floor: the floor's own sale would fire. */
export const protectBreached = (price: number, line: number, isLong: boolean) => (isLong ? price <= line : price >= line);

const usd = (n: number) => `$${n.toFixed(2)}`;
const since = (s: ProtectGains) => (s.from === "BUY" ? "since the buy" : "since Protect gains was turned on");

/** The Activity line a raise writes, and the floor's own note. A floor past the target says so; the target stays. */
export function raiseWords(h: Held, high: number, line: number, s: ProtectGains, target: number | null = null): { summary: string; note: string } {
  const past = target != null && (h.isLong ? line >= target : line <= target) ? `, past its ${usd(target)} target` : "";
  return {
    summary:
      line === buyCents(h)
        ? `Floor raised to ${usd(line)}, the buy price, to protect the gain (the high ${since(s)} is ${usd(high)})${past}`
        : `Floor raised to ${usd(line)} to protect the gain (${s.giveBackPct}% under the ${usd(high)} high ${since(s)})${past}`,
    note: `Protect gains: sells on a ${s.giveBackPct}% give-back from the ${usd(high)} high, never below the ${usd(h.avgCost)} buy price.`,
  };
}

/** The agents' one line on a held stock while the rule is on. */
export function protectForAgents(h: Held, high: number | null, s: ProtectGains): string {
  const line = protectLine(h, high, s);
  const buy = usd(h.avgCost);
  if (line != null && high != null) {
    return `The owner's Protect gains raises this stock's floor automatically and no analyst can lower it: it is held at ${usd(line)} or higher, ${s.giveBackPct}% under the ${usd(high)} high and never below the ${buy} buy price.`;
  }
  const arm = h.avgCost * (h.isLong ? 1 + s.startPct / 100 : 1 - s.startPct / 100);
  return `The owner's Protect gains raises this stock's floor automatically once it reaches ${usd(arm)}, ${s.startPct}% past the ${buy} buy price: ${s.giveBackPct}% under its high from then on, never below the buy price. No analyst can lower it.`;
}
