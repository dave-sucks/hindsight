/**
 * What the work flag reads for a set of theses (needs-action.ts), loaded once
 * in batch: the live price, the resolved ladder, the open position, the
 * chart numbers, the activity back to the newest answer, the audit rows a
 * fire's repeat count reads, the principal's declined sale, pending buys and
 * the account's equity. get_theses, the thesis sheet's quote route and
 * complete_run all read it here, so every surface computes the same list
 * from the same inputs. Moved from get_theses, which loaded it this way.
 * What the flag math reads, the row keeps (step 8): the day's change, the
 * chart snapshot and the orders awaiting approval ride on the load too.
 *
 * Fail-soft as the read was: a lookup that throws leaves its fields empty
 * and says so; nothing here refuses anything.
 */
import { prisma } from "@/lib/prisma";
import { getAccount, getBars, type AlpacaCredentials } from "@/lib/alpaca";
import { getLiveQuotes } from "@/lib/market-data/live-quote";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { loadLevelSources, resolveThesisLadder } from "@/lib/agent/triggers/load-levels";
import { getPendingEntryTickers } from "@/lib/proposals/pending-entry";
import { computeLadderHealth, isLadderEditUpdate } from "@/lib/agent/ladder-health";
import {
  declinedSaleWhere,
  declinedSaleWork,
  foldDeclines,
  isSystemicRejection,
  type DeclineRow,
  type DeclineSummary,
} from "@/lib/agent/declined-sale";
import { ACTIVITY_SELECT } from "@/lib/agent/stock-context-for";
import type { ActivityRow } from "@/lib/agent/stock-context";
import type { FireStreakUpdate } from "@/lib/agent/fire-streak";
import type { FloorStructure } from "@/lib/agent/floor-risk";
import type { NeedsActionInput } from "@/lib/agent/needs-action";
import type { Trigger } from "@/lib/agent/triggers/types";

export interface WorkContext {
  userId?: string;
  /** The analyst whose rules the ladder inherits and whose positions count; none ⇒ the stock's own triggers. */
  analystId?: string | null;
  runEnvironment?: "PAPER" | "LIVE";
  alpacaCreds?: AlpacaCredentials;
  /** A price the caller already fetched (price, unix-seconds stamp, the day's change in %), so the vendor is asked once. */
  prices?: Record<string, { price: number; t: number; dp: number | null }>;
}

/** The open position a held stock's flag reads. */
export interface OpenPosition {
  id: string;
  openedAt: Date;
  avgCost: number;
  quantity: number;
  peakPrice: number | null;
}

/** An order of this analyst's in the principal's queue: proposed, not yet approved. */
export interface PendingProposal {
  id: string;
  side: "BUY" | "SELL";
  /** OPEN, CLOSE, PARTIAL_CLOSE or ADD; null on an old row. */
  intent: string | null;
  quantity: number;
  createdAt: Date;
  expiresAt: Date | null;
}

/** An audit row the ladder-edit scan reads. */
export interface LadderEditRow {
  type: string;
  timestamp: Date;
  fieldChanges: unknown;
  priceAtTime: number | null;
  rationale: string | null;
}

export interface WorkLoad {
  /** Each live thesis's work-flag input, the declined sale on it. */
  inputs: Map<string, NeedsActionInput>;
  /** What the read also shows from the same loads. */
  ladders: Map<string, Trigger[]>;
  livePrice: Record<string, number>;
  priceAsOf: Record<string, string>;
  /** The day's change in %, per ticker, from the quote; absent when the quote had no prior close. */
  dayChange: Record<string, number>;
  priceFetchFailed: boolean;
  /** The 06:30 chart snapshot per upper-case ticker, the one the trigger check reads. */
  indicators: Map<string, IndicatorSnapshot>;
  positions: Map<string, OpenPosition>;
  /** The orders awaiting the principal's approval, per thesis. */
  proposals: Map<string, PendingProposal[]>;
  unapprovedExitCount: Map<string, number>;
  declines: Map<string, DeclineSummary>;
  recentLow: Map<string, number>;
  lastLadderEditAt: Map<string, Date>;
  ladderEditRows: Map<string, LadderEditRow[]>;
  equity: number | null;
  /** The activity read failed: open fires fall back to each stock's newest line. A caller that owes on fires fails loud. */
  activityFailed: boolean;
}

const LIVE = new Set(["HOLDING", "WATCHING", "PROMOTED"]);

export async function loadWorkInputs(thesisIds: string[], ctx: WorkContext, now: Date = new Date()): Promise<WorkLoad> {
  const theses = thesisIds.length
    ? await prisma.thesis.findMany({
        where: { id: { in: thesisIds } },
        select: {
          id: true, ticker: true, status: true, direction: true, horizon: true, entryPrice: true, targetPrice: true,
          triggers: true, triggerState: true, createdAt: true, lastReviewedAt: true, researchUpdatedAt: true,
          paperTenureDays: true, paperRealizedPnl: true, paperReviewCount: true, promotedAt: true,
        },
      })
    : [];
  const live = theses.filter((t) => LIVE.has(t.status));
  const load: WorkLoad = {
    inputs: new Map(), ladders: new Map(), livePrice: {}, priceAsOf: {}, dayChange: {}, priceFetchFailed: false,
    indicators: new Map(), positions: new Map(), proposals: new Map(), unapprovedExitCount: new Map(), declines: new Map(), recentLow: new Map(),
    lastLadderEditAt: new Map(), ladderEditRows: new Map(), equity: null, activityFailed: false,
  };

  // The live price, once, from the one place it comes from (live-quote): the
  // tape in the session, the last close outside it.
  // The day's change rides with it, for a trigger on the day's move.
  const dayChange = load.dayChange;
  if (live.length > 0) {
    try {
      const quotes = ctx.prices
        ? Object.entries(ctx.prices).map(([ticker, q]) => [ticker, { c: q.price, t: q.t, dp: q.dp }] as const)
        : Object.entries(await getLiveQuotes(live.map((t) => t.ticker), { caller: "other", creds: ctx.alpacaCreds })).map(([ticker, r]) => [ticker, r.quote] as const);
      for (const [ticker, quote] of quotes) {
        if (!quote) continue;
        load.livePrice[ticker] = quote.c;
        if (quote.t > 0) load.priceAsOf[ticker] = new Date(quote.t * 1000).toISOString();
        if (typeof quote.dp === "number" && Number.isFinite(quote.dp)) dayChange[ticker] = quote.dp;
      }
    } catch (err) {
      // getLiveQuotes does not throw; if it ever does, the caller shows the book in full.
      load.priceFetchFailed = true;
      console.warn("[work-inputs] live quote fetch failed; matching-now skipped:", err);
    }
  }

  // The resolved ladder: the stock's own triggers plus what it inherits from
  // the analyst and the account. A holding protected by an inherited floor
  // must not read as unprotected.
  const levelSources = ctx.analystId ? (await loadLevelSources([ctx.analystId])).get(ctx.analystId) : undefined;
  for (const t of theses) load.ladders.set(t.id, resolveThesisLadder(t, levelSources, `thesis=${t.id}`) as Trigger[]);

  // The open position per held stock (scoped by analyst, and environment when
  // known), and the closes the principal did not approve on it: rejected or
  // left to expire. A protective one inside the window is a declined sale.
  const positions = load.positions;
  const held = Array.from(new Set(theses.filter((t) => t.status === "HOLDING").map((t) => t.ticker)));
  let positionEnv: "PAPER" | "LIVE" | undefined;
  if (held.length > 0) {
    try {
      const open = await prisma.position.findMany({
        where: {
          userId: ctx.userId, symbol: { in: held }, status: "OPEN",
          ...(ctx.analystId ? { analystId: ctx.analystId } : {}),
          ...(ctx.runEnvironment ? { environment: ctx.runEnvironment } : {}),
        },
        select: { id: true, symbol: true, openedAt: true, avgCost: true, quantity: true, peakPrice: true, environment: true },
        orderBy: { openedAt: "desc" },
      });
      const bySymbol = new Map<string, (typeof open)[number]>();
      for (const p of open) if (!bySymbol.has(p.symbol)) bySymbol.set(p.symbol, p);
      for (const t of theses) {
        const p = t.status === "HOLDING" ? bySymbol.get(t.ticker) : undefined;
        if (!p) continue;
        positionEnv ??= p.environment as "PAPER" | "LIVE";
        const peak = p.peakPrice != null && Number.isFinite(Number(p.peakPrice)) ? Number(p.peakPrice) : null;
        positions.set(t.id, { id: p.id, openedAt: p.openedAt, avgCost: Number(p.avgCost), quantity: Number(p.quantity), peakPrice: peak });
      }
      const ids = Array.from(new Set(Array.from(positions.values(), (p) => p.id)));
      if (ids.length > 0) {
        // Every close the principal did not approve counts; a protective one
        // inside the window is a declined sale. Both from declined-sale.ts's
        // one definition of a decline.
        const declined = declinedSaleWhere(now);
        const closes = await prisma.order.findMany({
          where: { positionId: { in: ids }, side: "SELL", intent: declined.intent, status: declined.status, expiresAt: declined.expiresAt },
          orderBy: { createdAt: "desc" },
          select: { positionId: true, rejectionMessage: true, closeReason: true, createdAt: true, status: true, expiresAt: true, updatedAt: true },
        });
        const counts = new Map<string, number>();
        const declineRows = new Map<string, DeclineRow[]>();
        for (const o of closes) {
          if (isSystemicRejection(o.rejectionMessage)) continue;
          counts.set(o.positionId, (counts.get(o.positionId) ?? 0) + 1);
          if (o.closeReason === declined.closeReason && o.createdAt >= declined.createdAt.gte) {
            declineRows.set(o.positionId, [...(declineRows.get(o.positionId) ?? []), { createdAt: o.createdAt, rejectionMessage: o.rejectionMessage, status: o.status, expiresAt: o.expiresAt, updatedAt: o.updatedAt }]);
          }
        }
        for (const [thesisId, { id: posId }] of positions) {
          const n = counts.get(posId) ?? 0;
          if (n > 0) load.unapprovedExitCount.set(thesisId, n);
          const folded = foldDeclines(declineRows.get(posId) ?? []);
          if (folded) load.declines.set(thesisId, folded);
        }
      }
    } catch (err) {
      console.warn("[work-inputs] open-position / declined-close lookup failed:", err);
    }
  }

  // The orders awaiting the principal's approval on the live stocks, in one
  // query: a buy or add proposed and not yet approved, a sale in the queue.
  // The row says so, so a run does not propose it again (step 8). An order
  // carries its thesis since 2026-08-18; a proposal lives a day, so every
  // open one has it.
  if (live.length > 0) {
    try {
      const awaiting = await prisma.order.findMany({
        where: {
          userId: ctx.userId, status: "AWAITING_APPROVAL", thesisId: { in: live.map((t) => t.id) },
          ...(ctx.runEnvironment ? { environment: ctx.runEnvironment } : {}),
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, thesisId: true, side: true, intent: true, quantity: true, createdAt: true, expiresAt: true },
      });
      for (const o of awaiting) {
        if (!o.thesisId) continue;
        const p: PendingProposal = { id: o.id, side: o.side === "SELL" ? "SELL" : "BUY", intent: o.intent ?? null, quantity: Number(o.quantity), createdAt: o.createdAt, expiresAt: o.expiresAt ?? null };
        load.proposals.set(o.thesisId, [...(load.proposals.get(o.thesisId) ?? []), p]);
      }
    } catch (err) {
      console.warn("[work-inputs] awaiting-approval lookup failed:", err);
    }
  }

  // The last ladder edit per held or priced watched stock, from one capped
  // scan of CREATED/UPDATED rows. Truncated with no match ⇒ unknown; complete
  // with no match ⇒ the ladder was born with the thesis.
  const scanIds = theses.filter((t) => t.status === "HOLDING" || (t.status === "WATCHING" && t.entryPrice != null)).map((t) => t.id);
  if (scanIds.length > 0) {
    try {
      const take = Math.min(40 * scanIds.length, 600);
      const rows = await prisma.thesisUpdate.findMany({
        where: { thesisId: { in: scanIds }, type: { in: ["CREATED", "UPDATED"] } },
        orderBy: { timestamp: "desc" },
        take,
        select: { thesisId: true, type: true, timestamp: true, fieldChanges: true, priceAtTime: true, rationale: true },
      });
      const matched = new Set<string>();
      for (const r of rows) {
        load.ladderEditRows.set(r.thesisId, [...(load.ladderEditRows.get(r.thesisId) ?? []), r]);
        if (!matched.has(r.thesisId) && isLadderEditUpdate(r.type, r.fieldChanges)) {
          load.lastLadderEditAt.set(r.thesisId, r.timestamp);
          matched.add(r.thesisId);
        }
      }
      if (rows.length < take) for (const t of theses) if (scanIds.includes(t.id) && !matched.has(t.id)) load.lastLadderEditAt.set(t.id, t.createdAt);
    } catch (err) {
      console.warn("[work-inputs] ladder-edit scan failed:", err);
    }
  }

  // The recent low (the recent HIGH for a short) since the ladder was last
  // edited, clamped to 5–30 days, for each stock with a declined sale: a
  // real level to offer for the line.
  await Promise.all(
    theses
      .filter((t) => t.status === "HOLDING" && load.declines.has(t.id))
      .map(async (t) => {
        try {
          const since = load.lastLadderEditAt.get(t.id);
          const days = Math.min(Math.max(since ? Math.ceil((now.getTime() - since.getTime()) / 86_400_000) : 30, 5), 30);
          const bars = await getBars(
            t.ticker,
            { start: new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) },
            ctx.alpacaCreds,
          );
          const isLong = t.direction !== "SHORT";
          const extremes = bars.map((b) => (isLong ? b.low ?? b.close : b.high ?? b.close)).filter((v): v is number => typeof v === "number" && v > 0);
          if (extremes.length > 0) load.recentLow.set(t.id, isLong ? Math.min(...extremes) : Math.max(...extremes));
        } catch (err) {
          console.warn(`[work-inputs] recent-low fetch failed for ${t.ticker}:`, err);
        }
      }),
  );

  // The account's equity, when anything is held: a floor's loss is judged against it.
  if (positions.size > 0) {
    try {
      const env = ctx.runEnvironment ?? positionEnv;
      const creds = ctx.alpacaCreds ?? (env && ctx.userId ? await resolveAlpacaCredentials(ctx.userId, env) : null) ?? undefined;
      const equity = parseFloat((await getAccount(creds)).equity);
      if (Number.isFinite(equity) && equity > 0) load.equity = equity;
    } catch (err) {
      console.warn("[work-inputs] account equity unavailable; floor-risk check skipped:", err);
    }
  }

  // ATR(14) and the structure a floor could sit under, from the daily snapshot the evaluator reads.
  const atr = new Map<string, number>();
  const structure = new Map<string, FloorStructure>();
  if (live.length > 0) {
    try {
      for (const [ticker, snap] of await loadIndicatorSnapshots(live.map((t) => t.ticker.toUpperCase()))) {
        load.indicators.set(ticker, snap);
        if (snap.atr14 != null && snap.atr14 > 0) atr.set(ticker, snap.atr14);
        structure.set(ticker, { low20: snap.low20, sma20: snap.sma[20], sma50: snap.sma[50], sma200: snap.sma[200] });
      }
    } catch (err) {
      console.warn("[work-inputs] indicator snapshot load failed:", err);
    }
  }
  if (live.length === 0) return load;

  // The activity: one capped scan (40 lines a stock covers a month), the
  // principal's notes at any age, and the newest line alone for a stock the
  // scan truncated away.
  const liveIds = live.map((t) => t.id);
  const latest = new Map(
    (
      await prisma.thesisUpdate.findMany({
        where: { thesisId: { in: liveIds } },
        orderBy: { timestamp: "desc" },
        distinct: ["thesisId"],
        select: { id: true, thesisId: true, type: true, triggerId: true, timestamp: true, runId: true, summary: true, rationale: true, fieldChanges: true, priceAtTime: true },
      })
    ).map((u) => [u.thesisId, u]),
  );
  const streak = new Map<string, FireStreakUpdate[]>();
  const activity = new Map<string, ActivityRow[]>();
  try {
    const scan = await prisma.thesisUpdate.findMany({
      where: { thesisId: { in: liveIds } },
      orderBy: { timestamp: "desc" },
      take: Math.min(40 * liveIds.length, 1200),
      select: ACTIVITY_SELECT,
    });
    const notes = await prisma.thesisUpdate.findMany({ where: { thesisId: { in: liveIds }, type: "NOTE" }, select: ACTIVITY_SELECT });
    const seen = new Set(scan.map((r) => r.id));
    scan.push(...notes.filter((n) => !seen.has(n.id)));
    for (const row of scan) {
      streak.set(row.thesisId, [...(streak.get(row.thesisId) ?? []), row]);
      activity.set(row.thesisId, [...(activity.get(row.thesisId) ?? []), { ...row, runMode: row.run?.mode ?? null }]);
    }
  } catch (err) {
    load.activityFailed = true;
    console.warn("[work-inputs] activity scan failed; open fires read from the newest line only:", err);
  }

  const pending = ctx.analystId ? await getPendingEntryTickers(ctx.analystId) : new Set<string>();
  for (const t of live) {
    const price = load.livePrice[t.ticker];
    // No prior close to measure from: 0, which no move threshold matches.
    const quote = typeof price === "number" && price > 0 ? { price, changePct: dayChange[t.ticker] ?? 0 } : null;
    const pos = positions.get(t.id);
    const triggers = load.ladders.get(t.id) ?? [];
    const latestRow = latest.get(t.id);
    const input: NeedsActionInput = {
      thesis: {
        id: t.id, direction: t.direction, status: t.status, triggers, createdAt: t.createdAt,
        lastReviewedAt: t.lastReviewedAt, researchUpdatedAt: t.researchUpdatedAt ?? null, horizon: t.horizon ?? null,
        positionOpenedAt: pos?.openedAt ?? null,
        avgCost: pos && Number.isFinite(pos.avgCost) ? pos.avgCost : null,
        peakPrice: pos?.peakPrice ?? null,
        atr14: atr.get(t.ticker.toUpperCase()) ?? null, quantity: pos && pos.quantity > 0 ? pos.quantity : null,
        structure: structure.get(t.ticker.toUpperCase()) ?? null, targetPrice: t.targetPrice ?? null,
        paperTenureDays: t.paperTenureDays ?? null,
        paperRealizedPnl: t.paperRealizedPnl != null ? Number(t.paperRealizedPnl) : null,
        paperReviewCount: t.paperReviewCount ?? null, promotedAt: t.promotedAt ?? null,
      },
      activity: activity.get(t.id) ?? (latestRow ? [latestRow] : []),
      recentUpdates: streak.get(t.id),
      latestQuote: quote,
      now,
      hasPendingEntryProposal: pending.has(t.ticker),
      equity: load.equity,
    };
    // A declined sale, judged against the ladder's floor and the live price.
    const decline = load.declines.get(t.id);
    if (decline) {
      const floor = computeLadderHealth({
        direction: t.direction, avgCost: input.thesis.avgCost ?? null, currentPrice: quote?.price ?? null, peakPrice: pos?.peakPrice ?? null,
        triggers, atr14: input.thesis.atr14 ?? null, lastLadderEditAt: null, now,
      })?.floor?.price ?? null;
      input.declinedSale = declinedSaleWork({
        status: t.status, direction: t.direction, decline, floorPrice: floor, currentPrice: quote?.price ?? null,
        recentLow: load.recentLow.get(t.id) ?? null, now,
      });
    }
    load.inputs.set(t.id, input);
  }
  return load;
}
