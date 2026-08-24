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

import { prisma } from "@/lib/prisma";
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

// ── Name history ─────────────────────────────────────────────────────────
// "Have we been here before?" — the second bundle slice (THREE_SYSTEMS.md
// Move 1). Before this, only the thesis-writer knew, via an inline lookup
// that saw one narrow case (a sale in the last 14 days). Discovery could
// re-pick a name the same analyst rejected three weeks ago, and a refresh
// could re-underwrite a stock it stopped out of, with no memory of either.
//
// Verified on the live book 2026-08-23: 9 live plans sit on names their own
// analyst had already passed on or sold — PLTR (2 passes + a sale), MU (2
// sales), KLAC and NTNX (sold, then re-watched with stale levels).

export interface PriorExit {
  /** Price recorded on the closing audit row; null when not resolvable. */
  exitPrice: number | null;
  daysAgo: number;
  closeReason: string | null;
}

export interface PriorVerdict {
  /** "PASSED" (researched and declined) or "SOLD". */
  verdict: "PASSED" | "SOLD";
  daysAgo: number;
  /** The analyst's own words at the time, trimmed. */
  reason: string | null;
}

export interface NameHistory {
  ticker: string;
  /** Most recent sale by this analyst. Drives the #524 acknowledgment gate. */
  lastExit: PriorExit | null;
  /** Prior verdicts on this name, newest first (capped). */
  priorVerdicts: PriorVerdict[];
  /** How many times this analyst has held this name before. */
  timesHeld: number;
}

const daysSince = (d: Date) =>
  Math.floor((Date.now() - d.getTime()) / 86_400_000);

/**
 * Bulk data-repair closes masquerading as trading decisions.
 *
 * 99 of the ~140 SOLD rows on the live book are date-stamped cleanup
 * artifacts ("orphan-cleanup-2026-05-06: not held, not on watchlist" ×86,
 * "cleanup-2026-05-07: PASS-decorative…" ×13). Telling an analyst "you sold
 * PLTR 109 days ago" when a script marked the row is exactly the kind of
 * false context this module exists to eliminate — so these never count as
 * a sale, a verdict, or a times-held.
 */
export function isHousekeepingClose(reason: string | null): boolean {
  if (!reason) return false;
  return /^\s*(orphan-)?cleanup-\d{4}-\d{2}-\d{2}/i.test(reason);
}

/**
 * One name's history for one analyst. Fail-open: any error yields an empty
 * history (no lastExit, no verdicts) — context must never kill a run, and
 * the persist-side gates still enforce independently.
 */
export async function getNameHistory(args: {
  analystId: string;
  ticker: string;
  /** How far back prior verdicts stay interesting. Default 180d. */
  windowDays?: number;
  /** Max verdicts returned, newest first. Default 4. */
  limit?: number;
}): Promise<NameHistory> {
  const { analystId, limit = 4, windowDays = 180 } = args;
  const ticker = args.ticker.toUpperCase().trim();
  const empty: NameHistory = {
    ticker,
    lastExit: null,
    priorVerdicts: [],
    timesHeld: 0,
  };

  try {
    const rows = await prisma.thesis.findMany({
      where: {
        ticker,
        researchRun: { agentConfigId: analystId },
        status: { in: ["PASSED", "RETIRED"] },
        createdAt: { gte: new Date(Date.now() - windowDays * 86_400_000) },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        retiredReason: true,
        closedAt: true,
        closeReason: true,
        createdAt: true,
        invalidReason: true,
        // A PASS stores its FLIP CRITERIA here — "what would have to change
        // for me to buy this" (e.g. TOST: "price pulls back to SMA20 with
        // RSI reset below 55 — restores a clean entry"). It is the single
        // most useful line to hand an agent re-encountering the name, and
        // closeReason is empty on PASS rows.
        invalidationConds: true,
      },
    });
    if (rows.length === 0) return empty;

    const sold = rows.filter(
      (r) =>
        r.status === "RETIRED" &&
        r.retiredReason === "SOLD" &&
        !isHousekeepingClose(r.closeReason),
    );

    // Exit price lives on the closing audit row, not the thesis.
    let lastExit: PriorExit | null = null;
    const newestSale = sold.find((r) => r.closedAt != null);
    if (newestSale?.closedAt) {
      const closedRow = await prisma.thesisUpdate.findFirst({
        where: { thesisId: newestSale.id, type: "CLOSED" },
        orderBy: { timestamp: "desc" },
        select: { priceAtTime: true },
      });
      const px = closedRow?.priceAtTime;
      lastExit = {
        exitPrice: px != null && Number.isFinite(Number(px)) ? Number(px) : null,
        daysAgo: daysSince(newestSale.closedAt),
        closeReason: newestSale.closeReason ?? null,
      };
    }

    const priorVerdicts: PriorVerdict[] = rows
      .filter(
        (r) =>
          r.status === "PASSED" ||
          (r.status === "RETIRED" &&
            r.retiredReason === "SOLD" &&
            !isHousekeepingClose(r.closeReason)),
      )
      .slice(0, limit)
      .map((r) => ({
        verdict: r.status === "PASSED" ? ("PASSED" as const) : ("SOLD" as const),
        daysAgo: daysSince(r.closedAt ?? r.createdAt),
        // PASS → the flip criteria (what would change the answer).
        // SOLD → why it was sold.
        reason:
          (r.status === "PASSED"
            ? (r.invalidationConds?.[0] ?? r.invalidReason)
            : (r.closeReason ?? r.invalidReason)
          )?.slice(0, 200) ?? null,
      }));

    return { ticker, lastExit, priorVerdicts, timesHeld: sold.length };
  } catch (err) {
    console.warn(
      `[context-bundle] name history failed for ${ticker}:`,
      err instanceof Error ? err.message : err,
    );
    return empty;
  }
}

/** Pure: name history as a prompt block. Empty string when there's no past. */
export function formatNameHistoryBlock(h: NameHistory): string {
  if (h.lastExit == null && h.priorVerdicts.length === 0) return "";
  const lines: string[] = [
    `YOUR OWN HISTORY ON $${h.ticker} — you have judged this name before:`,
  ];
  if (h.lastExit) {
    lines.push(
      `  • You SOLD it ${h.lastExit.daysAgo} day${h.lastExit.daysAgo === 1 ? "" : "s"} ago` +
        `${h.lastExit.exitPrice != null ? ` at $${h.lastExit.exitPrice}` : ""}` +
        `${h.lastExit.closeReason ? ` (${h.lastExit.closeReason})` : ""}.`,
    );
  }
  for (const v of h.priorVerdicts) {
    if (v.verdict === "SOLD" && h.lastExit?.daysAgo === v.daysAgo) continue;
    lines.push(
      `  • ${v.verdict === "PASSED" ? "You researched it and PASSED" : "You sold it"} ${v.daysAgo}d ago` +
        `${v.reason ? ` — "${v.reason}"` : ""}.`,
    );
  }
  lines.push(
    `  Underwrite with that in view: say what is DIFFERENT now, or reach the same conclusion faster. Repeating a rejected setup without engaging with why you rejected it is the failure mode this context exists to prevent.`,
  );
  return lines.join("\n");
}

/**
 * Compact "names you've already judged" roster for DISCOVERY, which picks
 * candidates mid-run and so can't prefetch per-ticker history. Capped and
 * recency-windowed — the point is preventing a blind re-pick of a name the
 * analyst rejected weeks ago, not reciting the whole archive.
 */
export async function getRecentVerdictRoster(args: {
  analystId: string;
  windowDays?: number;
  limit?: number;
}): Promise<Array<{ ticker: string; verdict: "PASSED" | "SOLD"; daysAgo: number }>> {
  const { analystId, windowDays = 60, limit = 25 } = args;
  try {
    const rows = await prisma.thesis.findMany({
      where: {
        researchRun: { agentConfigId: analystId },
        status: { in: ["PASSED", "RETIRED"] },
        createdAt: { gte: new Date(Date.now() - windowDays * 86_400_000) },
      },
      orderBy: { createdAt: "desc" },
      select: {
        ticker: true,
        status: true,
        retiredReason: true,
        closeReason: true,
        closedAt: true,
        createdAt: true,
      },
    });
    const seen = new Set<string>();
    const out: Array<{
      ticker: string;
      verdict: "PASSED" | "SOLD";
      daysAgo: number;
    }> = [];
    for (const r of rows) {
      const isSold =
        r.status === "RETIRED" &&
        r.retiredReason === "SOLD" &&
        !isHousekeepingClose(r.closeReason);
      if (r.status !== "PASSED" && !isSold) continue;
      const t = r.ticker.toUpperCase();
      if (seen.has(t)) continue; // newest verdict per ticker wins
      seen.add(t);
      out.push({
        ticker: t,
        verdict: isSold ? "SOLD" : "PASSED",
        daysAgo: daysSince(r.closedAt ?? r.createdAt),
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    console.warn(
      `[context-bundle] verdict roster failed for analyst=${analystId}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
