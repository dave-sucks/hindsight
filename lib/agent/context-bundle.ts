/**
 * Our history with one stock (getTickerHistory, formatTickerHistory): our
 * trades on it, the last thesis and what it believed, other seats' coverage.
 * get_stock_data attaches it to every research call, and the Writer reads it
 * in the stock's data. Fail-open: a read that fails yields nothing, never a
 * thrown error.
 */

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

/* ────────────────────────────────────────────────────────────────────────
 * PER-TICKER HISTORY — what happened last time we looked at this specific
 * name.
 *
 * A book summary has two limits that matter here. It is capped (25 closes), and it is derived from
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
export function formatTickerHistory(h: TickerHistory, opts: { lookup?: boolean } = {}): string | null {
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
    // Only for a reader that has get_theses (the Writer has not).
    if (opts.lookup !== false) {
      parts.push(
        `Full prior thesis — the opinion, the KPIs, the triggers and the whole audit trail — is available: get_theses(tickers: ["${h.ticker}"], status: ["${t.status}"], include_history: true).`,
      );
    }
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
