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

/* ────────────────────────────────────────────────────────────────────────
 * Second slice: THE BOOK — what this seat holds, what it is watching, and
 * what it has already traded.
 *
 * Why past holds live in the bundle rather than behind a tool call: on
 * 2026-08-25 a Catalyst triage session graded 13 candidates without ever
 * calling get_theses or get_portfolio_context. Everything it "knew" about
 * our history came from the scout output it was handed, so it scored names
 * on whether the FDA approved the drug rather than on what the position
 * made us — repeating MNKD ("textbook low-risk supplemental, approved
 * early July") as a positive when that position stopped out for −$345.
 *
 * A tool the agent MAY call is not context. The daily run hands its agent
 * the book; every other path that can write a thesis now does the same.
 *
 * The second failure this closes: a name we used to hold is currently
 * reachable by nothing. Discovery receives active+watching tickers as an
 * exclusion list and past holds not at all, so the three best trades this
 * seat ever made (XENE +$966, ARQT +$845, VRDN +$445) became invisible the
 * moment they filled. Past holds ship as CANDIDATES with their P&L
 * attached, and the prompt says so in words.
 * ──────────────────────────────────────────────────────────────────────── */

export interface BookPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
  notionalUSD: number;
  openedAt: Date | null;
}

export interface BookWatch {
  ticker: string;
  /** WATCHING | HOLDING | PROMOTED — the seat's coverage book. */
  status: string;
  catalystDate: Date | null;
  conviction: string | null;
}

export interface BookPastHold {
  symbol: string;
  realizedPnlUSD: number | null;
  returnPct: number | null;
  outcome: string | null;
  closeReason: string | null;
  closedAt: Date | null;
  /** #524's attestation. null = closed before the field existed. */
  beliefSurvived: boolean | null;
}

export interface BookContext {
  openPositions: BookPosition[];
  watching: BookWatch[];
  /** Most recent closes first. Excludes reconcile/promotion bookkeeping. */
  pastHolds: BookPastHold[];
  /**
   * False when the book could not be read at all (DB unreachable, etc.).
   *
   * This distinction is load-bearing and was found by probing the real
   * book: the rest of the bundle fails open to nulls, and a null equity
   * renders as "unavailable — size toward the top of the band," which is
   * honest. An unread BOOK failing open to empty arrays instead renders as
   * "Holding now: nothing" — a confident false statement about a seat that
   * holds two live positions. Telling an agent it owns nothing is worse
   * than telling it nothing. When this is false the block renders empty
   * and the agent falls back to get_theses / get_portfolio_context.
   */
  loaded: boolean;
}

const PAST_HOLD_LIMIT = 25;

/**
 * Read the seat's book. Fail-open like the rest of the bundle: any query
 * that throws yields an empty list, never a thrown error.
 */
export async function getBookContext(args: {
  analystId: string;
  environment?: string | null;
}): Promise<BookContext> {
  const { prisma } = await import("@/lib/prisma");
  const unread: BookContext = {
    openPositions: [],
    watching: [],
    pastHolds: [],
    loaded: false,
  };

  try {
    const [open, watching, closed] = await Promise.all([
      prisma.position.findMany({
        where: { analystId: args.analystId, status: "OPEN" },
        select: {
          symbol: true,
          quantity: true,
          avgCost: true,
          openedAt: true,
        },
        orderBy: { openedAt: "asc" },
      }),
      prisma.thesis.findMany({
        where: {
          status: { in: ["WATCHING", "HOLDING", "PROMOTED"] },
          researchRun: { agentConfigId: args.analystId },
        },
        select: {
          ticker: true,
          status: true,
          catalystDate: true,
          conviction: true,
        },
        orderBy: { catalystDate: "asc" },
      }),
      prisma.position.findMany({
        where: {
          analystId: args.analystId,
          status: "CLOSED",
          closeReason: { notIn: ["RECONCILE_DUPLICATE", "PROMOTED"] },
        },
        select: {
          symbol: true,
          direction: true,
          avgCost: true,
          closePrice: true,
          realizedPnl: true,
          outcome: true,
          closeReason: true,
          closedAt: true,
        },
        orderBy: { closedAt: "desc" },
        take: PAST_HOLD_LIMIT,
      }),
    ]);

    // Close orders carry #524's belief attestation; the Position row does
    // not. Join them up so "we sold on price, the story held" survives into
    // the prompt — that distinction is the whole point of a recycle path.
    const beliefBySymbol = new Map<string, boolean>();
    try {
      const closeOrders = await prisma.order.findMany({
        where: {
          symbol: { in: closed.map((c) => c.symbol) },
          intent: "CLOSE",
          status: "FILLED",
          closeBeliefSurvived: { not: null },
        },
        select: { symbol: true, closeBeliefSurvived: true, filledAt: true },
        orderBy: { filledAt: "desc" },
      });
      for (const o of closeOrders) {
        if (!beliefBySymbol.has(o.symbol) && o.closeBeliefSurvived != null) {
          beliefBySymbol.set(o.symbol, o.closeBeliefSurvived);
        }
      }
    } catch {
      /* fail-open — belief is an annotation, not a gate */
    }

    return {
      loaded: true,
      openPositions: open.map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        avgCost: p.avgCost,
        notionalUSD: Math.round(p.quantity * p.avgCost),
        openedAt: p.openedAt,
      })),
      watching: watching.map((t) => ({
        ticker: t.ticker,
        status: String(t.status),
        catalystDate: t.catalystDate,
        conviction: t.conviction,
      })),
      pastHolds: closed.map((c) => ({
        symbol: c.symbol,
        realizedPnlUSD: c.realizedPnl,
        returnPct: returnPctOf(c),
        outcome: c.outcome,
        closeReason: c.closeReason,
        closedAt: c.closedAt,
        beliefSurvived: beliefBySymbol.get(c.symbol) ?? null,
      })),
    };
  } catch (err) {
    // Loud, because a silently unread book is indistinguishable from an
    // empty one at the call site and the caller renders nothing either way.
    console.warn(
      `[context-bundle] book read FAILED for analyst=${args.analystId}:`,
      err instanceof Error ? err.message : err,
    );
    return unread;
  }
}

/** Pure: signed return on a closed position, direction-aware. */
export function returnPctOf(p: {
  direction: string | null;
  avgCost: number | null;
  closePrice: number | null;
}): number | null {
  if (!p.avgCost || !p.closePrice || p.avgCost <= 0) return null;
  const raw = ((p.closePrice - p.avgCost) / p.avgCost) * 100;
  const signed = p.direction === "SHORT" ? -raw : raw;
  return Math.round(signed * 10) / 10;
}

const fmtUSD = (n: number) =>
  `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n)).toLocaleString()}`;
const fmtDate = (d: Date | null) =>
  d ? d.toISOString().slice(0, 10) : "no date";

/**
 * Pure: the book as a prompt block, in product language.
 *
 * The past-holds section is deliberately instructional, not just a table.
 * A list of prior trades with no rule attached is exactly what the agent
 * had on 2026-08-25 (it read them out of a pasted scout report) and it
 * still treated "we touched this before" as a reason to skip.
 */
export function formatBookContextBlock(b: BookContext): string {
  // Unread ≠ empty. Say nothing rather than assert an empty book.
  if (!b.loaded) return "";
  const lines: string[] = ["THIS SEAT'S BOOK (live):"];

  lines.push(
    b.openPositions.length
      ? `  • Holding now (${b.openPositions.length}): ` +
          b.openPositions
            .map(
              (p) =>
                `$${p.symbol} ${p.quantity} sh @ $${p.avgCost.toFixed(2)} ≈ $${p.notionalUSD.toLocaleString()}`,
            )
            .join(" · ")
      : "  • Holding now: nothing.",
  );

  if (b.watching.length) {
    // Status is spelled out per name: this list is the coverage book, so it
    // includes HOLDING theses alongside watches. Labelling the whole line
    // "Watching" would misreport a held position as a candidate.
    lines.push(
      `  • Thesis coverage (${b.watching.length}): ` +
        b.watching
          .map(
            (w) =>
              `$${w.ticker} ${w.status}${w.catalystDate ? `, catalyst ${fmtDate(w.catalystDate)}` : ""}`,
          )
          .join(" · "),
    );
  }

  lines.push(
    "  • Held-or-watching names above are the ONLY names off-limits as new candidates.",
  );

  if (b.pastHolds.length) {
    lines.push("", "NAMES THIS SEAT HAS ALREADY TRADED — these are candidates, not exclusions:");
    for (const h of b.pastHolds) {
      const pnl = h.realizedPnlUSD != null ? fmtUSD(h.realizedPnlUSD) : "P&L unknown";
      const ret = h.returnPct != null ? ` (${h.returnPct > 0 ? "+" : ""}${h.returnPct}%)` : "";
      const belief =
        h.beliefSurvived === true
          ? ", sold on price — the reasoning still held"
          : h.beliefSurvived === false
            ? ", sold because the reasoning broke"
            : "";
      lines.push(
        `  • $${h.symbol} — closed ${fmtDate(h.closedAt)}, ${pnl}${ret}, exit ${h.closeReason ?? "—"}${belief}`,
      );
    }
    lines.push(
      "",
      "How to use that list — read it carefully, this has been got wrong:",
      "  • Having traded a name before does NOT disqualify it. If it now has a fresh dated",
      "    catalyst, it is often a BETTER candidate than a cold name: the research already",
      "    exists and you know how the stock behaves into its own events.",
      "  • Judge each name on what the POSITION made or lost us — the number above — not on",
      "    whether the event resolved favorably out in the world, and never on a scout's",
      "    win record. A drug can be approved while the trade loses money. That is the",
      "    ordinary case, not an edge case.",
      "  • A name sold on price while the reasoning held is the strongest re-entry",
      "    candidate of all. Treat it as a lead, not as history.",
      "  • A losing name is not banned either — say what is different this time, then judge it.",
      "  • The FULL prior thesis for any name above still exists — what we believed, the",
      "    conviction, the levels, why it was retired. Pull it with",
      "    get_theses(tickers: [\"TICKER\"], status: [\"RETIRED\", \"PASSED\"]) before you judge a",
      "    name we have already traded. You are not starting from scratch on these.",
    );
  }

  return lines.join("\n");
}
