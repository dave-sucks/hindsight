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
          id: true,
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
    // Matched on positionId, NOT symbol. A symbol match had two faults: it
    // carried no user/account filter at all (any tenant's CLOSE order on
    // the same ticker would match), and with one row per symbol it applied
    // one attestation to every trade of that name — so XENE's two round
    // trips, a win and a loss, would have shared a single belief flag.
    const beliefByPositionId = new Map<string, boolean>();
    try {
      const closeOrders = await prisma.order.findMany({
        where: {
          positionId: { in: closed.map((c) => c.id) },
          intent: "CLOSE",
          status: "FILLED",
          closeBeliefSurvived: { not: null },
        },
        select: { positionId: true, closeBeliefSurvived: true, filledAt: true },
        orderBy: { filledAt: "desc" },
      });
      for (const o of closeOrders) {
        if (
          o.positionId &&
          !beliefByPositionId.has(o.positionId) &&
          o.closeBeliefSurvived != null
        ) {
          beliefByPositionId.set(o.positionId, o.closeBeliefSurvived);
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
        beliefSurvived: beliefByPositionId.get(c.id) ?? null,
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
      "  • You do not have to ask for the detail: get_stock_data on any ticker returns our",
      "    prior thesis and trade history for that name automatically, including names we",
      "    researched and never traded. You are not starting from scratch on these.",
    );
  }

  return lines.join("\n");
}

/* ────────────────────────────────────────────────────────────────────────
 * Third slice: PER-TICKER HISTORY — what happened last time we looked at
 * this specific name.
 *
 * The book block above is a front-loaded summary, and a summary has two
 * limits that matter here. It is capped (25 closes), and it is derived from
 * POSITIONS — so a name we researched and declined, or watched and dropped
 * without ever trading, appears in it nowhere. NUVL, JAZZ, ZYME and RARE
 * are all invisible to it.
 *
 * More importantly, "the agent can call get_theses for the rest" is the
 * same shape as the bug this whole change exists to fix: a tool the agent
 * MAY call is not context. So the history attaches to the tool that
 * actually runs on every candidate at research time — get_stock_data —
 * and arrives whether or not the agent thought to ask.
 * ──────────────────────────────────────────────────────────────────────── */

export interface TickerTrade {
  /** Which seat took this trade. Null when it was this seat's own. */
  analystName: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  /** Calendar days held, when both ends are known. */
  heldDays: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  realizedPnlUSD: number | null;
  returnPct: number | null;
  outcome: string | null;
  closeReason: string | null;
}

export interface TickerHistory {
  ticker: string;
  /** Most recent thesis on this ticker for this seat — ANY status. */
  thesis: {
    id: string;
    status: string;
    direction: string | null;
    conviction: string | null;
    coreBelief: string | null;
    retiredReason: string | null;
    catalystDate: Date | null;
    researchUpdatedAt: Date | null;
  } | null;
  /** THIS seat's closed positions on the ticker, most recent first. */
  trades: TickerTrade[];
  /**
   * Closed positions taken by OTHER seats on the same account.
   *
   * Account-wide by principal's call (2026-08-27): a name is a name. If
   * another desk lost money on it we want to know before we buy it — AKAM
   * cost Catalyst $396 and Momentum $675 independently, and neither run
   * could see the other's result.
   */
  otherSeatTrades: TickerTrade[];
  /** Open position on this ticker right now, this seat. */
  openPosition: { quantity: number; avgCost: number; openedAt: Date | null } | null;
  /** Other seats holding or covering it right now: "Name (HOLDING)". */
  otherSeatCoverage: string[];
  /** False when the lookup failed — unread is not "no history". */
  loaded: boolean;
}

export async function getTickerHistory(args: {
  analystId: string;
  /** Account scope. Omit to fall back to this seat only. */
  accountId?: string | null;
  ticker: string;
}): Promise<TickerHistory> {
  const ticker = args.ticker.toUpperCase();
  const unread: TickerHistory = {
    ticker,
    thesis: null,
    trades: [],
    otherSeatTrades: [],
    openPosition: null,
    otherSeatCoverage: [],
    loaded: false,
  };

  try {
    const { prisma } = await import("@/lib/prisma");
    const [thesis, ownClosed, otherClosed, open, otherTheses, names] =
      await Promise.all([
      prisma.thesis.findFirst({
        where: { ticker, researchRun: { agentConfigId: args.analystId } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          direction: true,
          conviction: true,
          coreBelief: true,
          retiredReason: true,
          catalystDate: true,
          researchUpdatedAt: true,
        },
      }),
      // THIS seat's own trades, fetched separately and unconditionally.
      // Fetching the account's trades in one capped query and splitting
      // afterwards loses our own rows on a heavily-traded name: MU already
      // has 10 closes across 5 seats, so a busier desk's recent activity
      // could push this seat's own history out of the window — and that is
      // the single most important line in the block.
      prisma.position.findMany({
        where: {
          analystId: args.analystId,
          symbol: ticker,
          status: "CLOSED",
          closeReason: { notIn: ["RECONCILE_DUPLICATE", "PROMOTED"] },
        },
        orderBy: { closedAt: "desc" },
        take: 5,
        select: {
          direction: true,
          avgCost: true,
          closePrice: true,
          realizedPnl: true,
          outcome: true,
          closeReason: true,
          openedAt: true,
          closedAt: true,
          analystId: true,
        },
      }),
      // Other seats on the same account, separately capped.
      args.accountId
        ? prisma.position.findMany({
            where: {
              accountId: args.accountId,
              analystId: { not: args.analystId },
              symbol: ticker,
              status: "CLOSED",
              closeReason: { notIn: ["RECONCILE_DUPLICATE", "PROMOTED"] },
            },
            orderBy: { closedAt: "desc" },
            take: 5,
            select: {
              direction: true,
              avgCost: true,
              closePrice: true,
              realizedPnl: true,
              outcome: true,
              closeReason: true,
              openedAt: true,
              closedAt: true,
              analystId: true,
            },
          })
        : Promise.resolve([]),
      prisma.position.findFirst({
        where: { analystId: args.analystId, symbol: ticker, status: "OPEN" },
        select: { quantity: true, avgCost: true, openedAt: true },
      }),
      args.accountId
        ? prisma.thesis.findMany({
            where: {
              ticker,
              status: { in: ["WATCHING", "HOLDING", "PROMOTED"] },
              researchRun: {
                agentConfig: {
                  accountId: args.accountId,
                  id: { not: args.analystId },
                },
              },
            },
            orderBy: { createdAt: "desc" },
            select: { status: true, researchRun: { select: { agentConfigId: true } } },
          })
        : Promise.resolve([]),
      args.accountId
        ? prisma.agentConfig.findMany({
            where: { accountId: args.accountId },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const nameById = new Map(names.map((n) => [n.id, n.name]));
    const toTrade = (c: (typeof ownClosed)[number]): TickerTrade => ({
      analystName:
        c.analystId === args.analystId
          ? null
          : (nameById.get(c.analystId) ?? "another seat"),
      openedAt: c.openedAt,
      closedAt: c.closedAt,
      heldDays: heldDaysOf(c.openedAt, c.closedAt),
      entryPrice: c.avgCost,
      exitPrice: c.closePrice,
      realizedPnlUSD: c.realizedPnl,
      returnPct: returnPctOf(c),
      outcome: c.outcome,
      closeReason: c.closeReason,
    });

    return {
      ticker,
      loaded: true,
      thesis: thesis
        ? {
            id: thesis.id,
            status: String(thesis.status),
            direction: thesis.direction,
            conviction: thesis.conviction,
            coreBelief: thesis.coreBelief,
            retiredReason: thesis.retiredReason,
            catalystDate: thesis.catalystDate,
            researchUpdatedAt: thesis.researchUpdatedAt,
          }
        : null,
      trades: ownClosed.map(toTrade),
      otherSeatTrades: otherClosed.map(toTrade),
      otherSeatCoverage: [
        ...new Set(
          otherTheses.map((t) => {
            const id = t.researchRun.agentConfigId;
            const who = (id && nameById.get(id)) || "another seat";
            return `${who} (${String(t.status)})`;
          }),
        ),
      ],
      openPosition: open
        ? {
            quantity: open.quantity,
            avgCost: open.avgCost,
            openedAt: open.openedAt,
          }
        : null,
    };
  } catch (err) {
    console.warn(
      `[context-bundle] ticker history FAILED for ${ticker}:`,
      err instanceof Error ? err.message : err,
    );
    return unread;
  }
}

/** Pure: calendar days between entry and exit, when both are known. */
export function heldDaysOf(
  openedAt: Date | null,
  closedAt: Date | null,
): number | null {
  if (!openedAt || !closedAt) return null;
  const days = Math.round(
    (closedAt.getTime() - openedAt.getTime()) / 86_400_000,
  );
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/**
 * Pure: our history with one name, as prose the agent reads inline.
 *
 * Returns null when there is genuinely nothing (a name we have never
 * touched) OR when the lookup failed — in both cases the caller should say
 * nothing rather than assert "no prior coverage," which would be a false
 * statement in the failure case.
 */
export function formatTickerHistory(h: TickerHistory): string | null {
  if (!h.loaded) return null;
  if (
    !h.thesis &&
    !h.trades.length &&
    !h.openPosition &&
    !h.otherSeatTrades.length &&
    !h.otherSeatCoverage.length
  ) {
    return null;
  }

  const parts: string[] = [];

  if (h.openPosition) {
    parts.push(
      `WE HOLD IT NOW: ${h.openPosition.quantity} sh @ $${h.openPosition.avgCost.toFixed(2)}${
        h.openPosition.openedAt ? ` since ${fmtDate(h.openPosition.openedAt)}` : ""
      }.`,
    );
  }

  if (h.trades.length) {
    const traded = h.trades
      .map((t) => {
        const bought = `bought ${fmtDate(t.openedAt)}${t.entryPrice != null ? ` @ $${t.entryPrice.toFixed(2)}` : ""}`;
        const sold = `sold ${fmtDate(t.closedAt)}${t.exitPrice != null ? ` @ $${t.exitPrice.toFixed(2)}` : ""}`;
        const held = t.heldDays != null ? ` (held ${t.heldDays}d)` : "";
        const pnl =
          t.realizedPnlUSD != null ? fmtUSD(t.realizedPnlUSD) : "P&L unknown";
        const ret =
          t.returnPct != null
            ? ` (${t.returnPct > 0 ? "+" : ""}${t.returnPct}%)`
            : "";
        return `${bought}, ${sold}${held} → ${pnl}${ret}, exit ${t.closeReason ?? "—"}`;
      })
      .join("; ");
    parts.push(
      `WE HAVE TRADED THIS BEFORE — ${h.trades.length} closed position${h.trades.length === 1 ? "" : "s"}: ${traded}.`,
    );
  }

  if (h.thesis) {
    const t = h.thesis;
    const state =
      t.status === "RETIRED" && t.retiredReason
        ? `RETIRED (${t.retiredReason})`
        : t.status;
    parts.push(
      `LAST THESIS (${t.id}): ${state}${t.direction ? ` ${t.direction}` : ""}${
        t.conviction ? `, conviction ${t.conviction}` : ""
      }${t.researchUpdatedAt ? `, researched ${fmtDate(t.researchUpdatedAt)}` : ""}${
        t.catalystDate ? `, catalyst was ${fmtDate(t.catalystDate)}` : ""
      }.`,
    );
    if (t.coreBelief) {
      parts.push(`What we believed: "${t.coreBelief.trim()}"`);
    }
    parts.push(
      `Full prior thesis — assumptions, invalidation conditions, levels, triggers and the whole audit trail — is available: get_theses(tickers: ["${h.ticker}"], status: ["${t.status}"], include_history: true).`,
    );
  }

  if (h.otherSeatCoverage.length) {
    parts.push(
      `ANOTHER SEAT ON THIS ACCOUNT COVERS IT: ${h.otherSeatCoverage.join(", ")}.`,
    );
  }

  if (h.otherSeatTrades.length) {
    parts.push(
      `OTHER SEATS HAVE TRADED IT: ${h.otherSeatTrades
        .map(
          (t) =>
            `${t.analystName} ${fmtDate(t.closedAt)} ${
              t.realizedPnlUSD != null ? fmtUSD(t.realizedPnlUSD) : "P&L unknown"
            }${t.returnPct != null ? ` (${t.returnPct > 0 ? "+" : ""}${t.returnPct}%)` : ""}`,
        )
        .join("; ")}. Different mandate, so this is evidence rather than a verdict — but a name that has lost money on more than one desk deserves a harder look at why.`,
    );
  }

  // Closing instruction depends on WHOSE history this is. Saying "we
  // researched it without trading it" directly after listing five trades
  // by other desks reads as a contradiction.
  if (h.trades.length || h.openPosition) {
    parts.push(
      "Judge this name on what the position actually made or lost us above — not on whether the event resolved well in the world, and not on anyone's public record. If the setup is genuinely new, say what changed since last time.",
    );
  } else if (h.otherSeatTrades.length) {
    parts.push(
      "This seat has never traded it; other desks have. Read their results above, then say what your mandate sees that theirs did not — or what has changed since.",
    );
  } else {
    parts.push(
      "We researched this name before without trading it. Say what is different now before reaching the same conclusion or a different one.",
    );
  }

  return parts.join(" ");
}

/**
 * Pure: prior coverage as ONE short line, for the tool row the user sees.
 *
 * The full paragraph belongs in the model-facing summary; rendering it in
 * the chat's ticker chip would produce a wall of prose where a one-line
 * status belongs.
 */
export function formatTickerHistoryShort(h: TickerHistory): string | null {
  if (!h.loaded) return null;
  const bits: string[] = [];

  if (h.openPosition) bits.push("held now");

  if (h.trades.length) {
    const net = h.trades.reduce((sum, t) => sum + (t.realizedPnlUSD ?? 0), 0);
    bits.push(
      `${h.trades.length} prior trade${h.trades.length === 1 ? "" : "s"} ${fmtUSD(net)} net`,
    );
  }

  if (h.otherSeatTrades.length) {
    bits.push(
      h.otherSeatTrades.length === 1
        ? "1 on another desk"
        : `${h.otherSeatTrades.length} on other desks`,
    );
  }

  if (h.thesis && !h.openPosition) {
    bits.push(
      `last thesis ${
        h.thesis.status === "RETIRED" && h.thesis.retiredReason
          ? `RETIRED (${h.thesis.retiredReason})`
          : h.thesis.status
      }`,
    );
  }

  return bits.length ? `Prior coverage: ${bits.join(", ")}.` : null;
}
