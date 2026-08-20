/**
 * The agent context bundle — System 1's seed module (THREE_SYSTEMS.md §3,
 * Move 1: "make every agent start the way the daily run starts").
 *
 * One place that assembles the live context an agent needs before it writes
 * or sizes a plan, so each run mode stops growing its own partial copy.
 * Standing law (DAV-207): no agent write path ships without the bundle —
 * when a new mode needs money/history context, it imports from here; adding
 * another inline fetch to a mode file is the bug this module exists to end.
 *
 * First slice: MONEY — live account equity + the seat's position band,
 * with the floor expressed as a percent of real equity. Extracted from the
 * writer's inline #540 code (the first path that got it right) so the
 * writer, discovery, and future paths share one implementation.
 *
 * Everything here is FAIL-OPEN by design: a missing credential or a vendor
 * outage yields nulls, never a thrown error — context must never be the
 * reason an agent run dies. Downstream gates (record_thesis sub-floor,
 * place_trade band) fail open on the same nulls, so behavior degrades to
 * exactly what it was before the bundle existed.
 */

import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getAccount } from "@/lib/alpaca";
import { positionBand } from "@/lib/agent/position-sizing";

export interface MoneyContext {
  /** Live account equity, or null when creds/vendor were unavailable. */
  equityUSD: number | null;
  /** The seat's entry floor in dollars (0 = no floor configured). */
  floorDollars: number;
  /**
   * The seat's effective ceiling: PAPER → maxPositionSize; LIVE →
   * min(maxPositionSize, realMaxPosition) — same resolution place_trade
   * enforces (positionBand), so the number shown is the number that gates.
   */
  ceilingDollars: number | null;
  /**
   * The floor as a percent of live equity, rounded UP to one decimal —
   * "target_size_pct must be ≥ this to clear the floor." Null when either
   * input is unavailable.
   */
  floorPct: number | null;
}

export async function getMoneyContext(analyst: {
  userId: string;
  tradingEnvironment: string | null;
  // `unknown` deliberately: callers hand Prisma rows whose Decimal/BigInt
  // columns type as unknown; Number() normalizes all of them at runtime.
  minPositionSize: unknown;
  maxPositionSize: unknown;
  realMaxPosition?: unknown;
}): Promise<MoneyContext> {
  const environment =
    (analyst.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
  const floorDollars = Number(analyst.minPositionSize) || 0;
  const band = positionBand({
    environment,
    minPositionSize: Number(analyst.minPositionSize) || undefined,
    maxPositionSize: Number(analyst.maxPositionSize) || undefined,
    realMaxPosition: Number(analyst.realMaxPosition) || undefined,
  });

  let equityUSD: number | null = null;
  try {
    const creds =
      (await resolveAlpacaCredentials(analyst.userId, environment)) ??
      undefined;
    const eq = Number((await getAccount(creds))?.equity);
    if (Number.isFinite(eq) && eq > 0) equityUSD = eq;
  } catch {
    /* fail-open — no equity, no floorPct; downstream gates also fail open */
  }

  return {
    equityUSD,
    floorDollars,
    ceilingDollars: band.ceiling,
    floorPct: floorPctOf({ equityUSD, floorDollars }),
  };
}

/** Pure: the floor as a percent of equity, rounded UP to one decimal. */
export function floorPctOf(args: {
  equityUSD: number | null;
  floorDollars: number;
}): number | null {
  const { equityUSD, floorDollars } = args;
  if (equityUSD == null || equityUSD <= 0 || floorDollars <= 0) return null;
  return Math.ceil((floorDollars / equityUSD) * 1000) / 10;
}

/**
 * Pure: the money context as a prompt block, in product language. Modes may
 * wrap it with mode-specific teaching, but the NUMBERS always come from
 * here so every agent quotes the same reality.
 */
export function formatMoneyContextBlock(m: MoneyContext): string {
  if (m.floorDollars <= 0 && m.ceilingDollars == null) return "";
  const lines: string[] = ["ACCOUNT MONEY CONTEXT (live):"];
  if (m.equityUSD != null) {
    lines.push(`  • Account equity ≈ $${Math.round(m.equityUSD).toLocaleString()}.`);
  } else {
    lines.push(
      "  • Live equity unavailable this run — size toward the upper end of the band rather than under-sizing.",
    );
  }
  if (m.floorDollars > 0) {
    lines.push(
      `  • Per-entry band: $${Math.round(m.floorDollars).toLocaleString()} floor${
        m.ceilingDollars != null
          ? ` to $${Math.round(m.ceilingDollars).toLocaleString()} ceiling`
          : ""
      } — both ends enforced at trade time.`,
    );
    if (m.floorPct != null) {
      lines.push(
        `  • At current equity the floor is ${m.floorPct}% of the book — any plan sized below that is un-fillable by this seat's own rules.`,
      );
    }
    lines.push(
      "  • If conviction doesn't justify at least a full-floor position, the honest call is PASS — not a small size.",
    );
  } else if (m.ceilingDollars != null) {
    lines.push(
      `  • Per-entry ceiling: $${Math.round(m.ceilingDollars).toLocaleString()} (no floor configured).`,
    );
  }
  return lines.join("\n");
}
