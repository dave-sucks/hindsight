/**
 * A stock's facts, for one stock or the whole book: the work-flag list and
 * what's been said on it, the resolved envelope (the price-dependent plan
 * facts and checks), a buy into a full analyst, and the situation sources.
 * get_theses and the thesis sheet's quote route both call it, so the sheet
 * shows what the read shows. Moved from get_theses, which assembled it this
 * way; the price and the work-flag inputs come from work-inputs.ts.
 */
import { prisma } from "@/lib/prisma";
import { getDailyRangePcts } from "@/lib/alpaca";
import { computeNeedsAction, type NeedsAction } from "@/lib/agent/needs-action";
import { loadWorkInputs, type WorkContext, type WorkLoad } from "@/lib/agent/work-inputs";
import type { StockContext } from "@/lib/agent/stock-context";
import { stockContextFor } from "@/lib/agent/stock-context-for";
import { buildResolvedEnvelope, buildSupersessionMap, type ResolvedEnvelope } from "@/lib/agent/resolved-thesis";
import { entryRaisesAway, type EntryRaiseAway } from "@/lib/agent/entry-raises";
import { nameTheSetup } from "@/lib/agent/knowledge/setup-checklist";
import { buyBlockedByFull, isFull, type AnalystCapacity, type BuyBlockedByFull } from "@/lib/agent/capacity";
import { spentBuyCrossing, type SpentBuyCrossing } from "@/lib/agent/buy-crossing";
import { getSetup } from "@/lib/agent/knowledge/setups";
import { loadSetupOverrides } from "@/lib/agent/knowledge/load-setup-overrides";
import type { SetupOverrides } from "@/lib/agent/knowledge/setup-overrides";
import type { SituationSources } from "@/lib/agent/situations";

/** The thesis columns the facts read. */
export interface FactsRow {
  id: string;
  ticker: string;
  status: string;
  direction: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  triggers: unknown;
  catalystDate: Date | null;
  setupId: string | null;
  horizon: string | null;
  createdAt: Date;
  scoring: unknown;
  /** The stock's analyst: its own setups, which a row with none may choose from, and on an account-wide read its minimum score. */
  researchRun: { agentConfigId?: string | null; agentConfig: { setupIds: string[]; minConfidence?: number | null } | null } | null;
}

export interface FactsContext extends WorkContext {
  accountId?: string | null;
  /** The owning analyst's minimum confidence, for the plan check. */
  minConfidence?: number | null;
  maxOpenPositions?: number | null;
  /**
   * Where the analyst's slot count comes from: these rows (the whole book
   * was read), its positions (one stock was read), or nowhere (a read
   * filtered to some tickers, whose held list is partial, skips the check).
   */
  slots: "rows" | "positions" | null;
}

/** A protective sale the principal declined, the price still past the floor: what both doors show under this name. */
export interface HeldThroughFloor {
  floorPrice: number;
  heldThroughCount: number;
  rejectMessage: string | null;
  recentLow: number | null;
}

export interface StockFacts {
  load: WorkLoad;
  /** When the plan facts were judged. */
  now: Date;
  setupOverrides: SetupOverrides;
  /** computeNeedsAction's list per live stock, lead first. */
  needs: Map<string, NeedsAction[]>;
  /** What's been said on each live stock (stock-context.ts). */
  context: Map<string, StockContext>;
  resolved: Map<string, ResolvedEnvelope>;
  blocked: Map<string, BuyBlockedByFull>;
  /** What situationsFor and listsTheStock read, per stock. */
  sources: Map<string, SituationSources>;
  heldThroughFloor: Map<string, HeldThroughFloor>;
}

/**
 * The analyst's slots, counted the way place_trade counts them: held PLUS
 * awaiting approval, which have already taken their slot.
 */
async function slotCount(theses: FactsRow[], ctx: FactsContext): Promise<AnalystCapacity | null> {
  if (ctx.slots == null || ctx.maxOpenPositions == null) return null;
  if (ctx.slots === "positions") {
    if (!ctx.analystId) return null;
    try {
      const rows = await prisma.position.findMany({
        where: { analystId: ctx.analystId, status: { in: ["OPEN", "PENDING_APPROVAL"] } },
        select: { symbol: true, status: true },
      });
      const held = rows.filter((r) => r.status === "OPEN").map((r) => r.symbol);
      return { open: rows.length, max: ctx.maxOpenPositions, held, awaitingApproval: rows.length - held.length };
    } catch {
      return null;
    }
  }
  const held = theses.filter((t) => t.status === "HOLDING").map((t) => t.ticker);
  let queued = 0;
  if (ctx.analystId) {
    try {
      queued = await prisma.position.count({ where: { analystId: ctx.analystId, status: "PENDING_APPROVAL" } });
    } catch {
      /* fail-soft to the held count */
    }
  }
  return { open: held.length + queued, max: ctx.maxOpenPositions, held, awaitingApproval: queued };
}

export async function loadStockFacts(theses: FactsRow[], ctx: FactsContext): Promise<StockFacts> {
  const load = await loadWorkInputs(
    theses.map((t) => t.id),
    { userId: ctx.userId, analystId: ctx.analystId, runEnvironment: ctx.runEnvironment, alpacaCreds: ctx.alpacaCreds, prices: ctx.prices },
  );
  const live = theses.filter((t) => t.status === "HOLDING" || t.status === "WATCHING" || t.status === "PROMOTED");

  // The work-flag list per live stock (lead first) and what's been said on
  // it: the block a full row carries, its open fires, and any decision of the
  // principal's no run has answered yet.
  const needs = new Map<string, NeedsAction[]>();
  const context = new Map<string, StockContext>();
  for (const t of live) {
    const input = load.inputs.get(t.id);
    if (!input) continue;
    context.set(
      t.id,
      stockContextFor({ ticker: t.ticker, rows: input.activity ?? [], triggers: input.thesis.triggers, now: input.now, currentPrice: input.latestQuote?.price ?? null }),
    );
    needs.set(t.id, computeNeedsAction(input));
  }

  // The buy level's moves away from the price, no structure cited
  // (DAV-253, the MSFT shape) — off the ladder-edit rows the loader read.
  const entryRaises = new Map<string, EntryRaiseAway[]>();
  for (const t of theses) {
    if (t.status !== "WATCHING") continue;
    const rows = load.ladderEditRows.get(t.id);
    if (!rows?.length) continue;
    const raises = entryRaisesAway({ direction: t.direction, updates: rows, now: new Date() });
    if (raises.length) entryRaises.set(t.id, raises);
  }

  // Supersession (Conviction Expression v4 §6): the newest terminal or
  // passed sibling on the same analyst, per ticker, so the resolver can flag
  // an older live row a newer sister thesis killed (the two-ZS case).
  // Per analyst: on an account-wide read each stock is matched against its own analyst's rows only.
  const analystOf = (t: FactsRow): string => ctx.analystId ?? t.researchRun?.agentConfigId ?? "";
  const tickers = Array.from(new Set(theses.map((t) => t.ticker)));
  const terminal =
    tickers.length > 0
      ? await prisma.thesis.findMany({
          where: {
            userId: ctx.userId,
            ticker: { in: tickers },
            ...(ctx.analystId ? { researchRun: { agentConfigId: ctx.analystId } } : {}),
            status: { in: ["RETIRED", "PASSED"] },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, ticker: true, createdAt: true, researchRun: { select: { agentConfigId: true } } },
        })
      : [];
  const supersessionByAnalyst = new Map<string, ReturnType<typeof buildSupersessionMap>>();
  for (const id of new Set(theses.map(analystOf))) {
    supersessionByAnalyst.set(id, buildSupersessionMap(terminal.filter((r) => !id || (ctx.analystId ?? r.researchRun?.agentConfigId) === id)));
  }

  // Daily ranges for the plan check's noise test (DAV-188): one batched
  // snapshot call, only for watched rows with a stop and an entry to compare.
  // Fail-open — absence just skips that one check.
  const rangeTickers = Array.from(
    new Set(
      theses
        .filter((t) => t.status === "WATCHING" && (t.direction === "LONG" || t.direction === "SHORT") && t.stopLoss != null && t.entryPrice != null)
        .map((t) => t.ticker.toUpperCase()),
    ),
  );
  let dayRangePct: Record<string, number> = {};
  if (rangeTickers.length > 0) {
    try {
      dayRangePct = await getDailyRangePcts(rangeTickers, ctx.alpacaCreds);
    } catch {
      /* fail-open — noise check silently skipped */
    }
  }

  const capacity = await slotCount(theses, ctx);
  const setupOverrides = await loadSetupOverrides(ctx.accountId);

  // A fired buy the price has left behind (DAV-303), off the audit rows the
  // loader read. Suppressed while the analyst is full: `buyBlockedByFull`
  // owns the row on those days.
  const now = new Date();
  const spent = new Map<string, SpentBuyCrossing>();
  if (!isFull(capacity)) {
    for (const t of theses) {
      if (t.status !== "WATCHING") continue;
      // The stock's OWN buy trigger: an inherited rule is not its buy plan.
      const enter =
        (load.ladders.get(t.id) ?? []).find((x) => x.action === "ENTER" && ((x as { level?: string }).level ?? "THESIS") === "THESIS") ?? null;
      const cur = load.livePrice[t.ticker];
      const crossing = spentBuyCrossing({
        status: t.status,
        direction: t.direction,
        currentPrice: typeof cur === "number" && cur > 0 ? cur : null,
        enter: enter ? { predicate: enter.predicate, lastFiredAt: enter.lastFiredAt ?? null } : null,
        chaseLimitPct: t.setupId ? (getSetup(t.setupId, setupOverrides)?.entry.chaseLimitPct ?? null) : null,
        updates: load.ladderEditRows.get(t.id) ?? [],
        now,
      });
      if (crossing) spent.set(t.id, crossing);
    }
  }

  // The resolved envelope per stock: the plan facts and checks against the price.
  const resolved = new Map<string, ResolvedEnvelope>();
  for (const t of theses) {
    const w = load.inputs.get(t.id)?.thesis;
    const cur = load.livePrice[t.ticker];
    resolved.set(
      t.id,
      buildResolvedEnvelope({
        thesis: {
          id: t.id,
          ticker: t.ticker,
          status: t.status,
          direction: t.direction,
          entryPrice: t.entryPrice,
          targetPrice: t.targetPrice ?? null,
          stopLoss: t.stopLoss ?? null,
          dayRangePct: dayRangePct[t.ticker.toUpperCase()] ?? null,
          atr14: w?.atr14 ?? null,
          avgCost: w?.avgCost ?? null,
          quantity: w?.quantity ?? null,
          equity: load.equity,
          structure: w?.structure ?? null,
          peakPrice: w?.peakPrice ?? null,
          lastLadderEditAt: load.lastLadderEditAt.get(t.id) ?? null,
          entryRaisesAway: entryRaises.get(t.id) ?? null,
          spentBuyCrossing: spent.get(t.id) ?? null,
          triggers: t.triggers,
          catalystDate: t.catalystDate,
          setupId: t.setupId ?? null,
          horizon: t.horizon ?? null,
          createdAt: t.createdAt,
          scoring: t.scoring,
          minConfidence: ctx.minConfidence ?? t.researchRun?.agentConfig?.minConfidence ?? null,
          parsedTriggers: load.ladders.get(t.id) ?? [],
          positionOpenedAt: w?.positionOpenedAt ?? null,
        },
        currentPrice: typeof cur === "number" && cur > 0 ? cur : null,
        priceAsOf: load.priceAsOf[t.ticker] ?? null,
        supersession: supersessionByAnalyst.get(analystOf(t))?.get(t.ticker) ?? null,
        now,
      }),
    );
  }

  // A buy that fired into a full analyst (DAV-286), off the slot count above.
  const blocked = new Map<string, BuyBlockedByFull>();
  for (const t of theses) {
    const own = Array.isArray(t.triggers) ? (t.triggers as Array<{ action?: string; lastFiredAt?: string }>) : [];
    const lead = needs.get(t.id)?.[0] ?? null;
    const b = buyBlockedByFull(
      {
        ticker: t.ticker,
        status: t.status,
        enterLastFiredAt: own.find((x) => x.action === "ENTER")?.lastFiredAt ?? null,
        enterLiveNow: lead?.kind === "TRIGGER_MATCHING_NOW" && lead.action === "ENTER",
      },
      capacity,
      new Date(),
    );
    if (b) blocked.set(t.id, b);
  }

  const sources = new Map<string, SituationSources>();
  for (const t of theses) {
    const r = resolved.get(t.id);
    sources.set(t.id, {
      needs: needs.get(t.id) ?? [],
      triggers: load.ladders.get(t.id) ?? [],
      status: t.status,
      direction: t.direction,
      planSanity: r?.planSanity ?? null,
      actionability: r?.actionability ?? null,
      progressToTarget: r?.progressToTarget ?? null,
      buyBlockedByFull: blocked.has(t.id),
      nameTheSetup: nameTheSetup(t, t.researchRun?.agentConfig?.setupIds ?? null) !== null,
      unansweredDecision: context.get(t.id)?.unansweredDecision != null,
    });
  }

  // A declined protective sale, shown only while the breach is LIVE: the
  // price still on the losing side of the ladder's tightest protective
  // floor. Once it recovers the floor held and the next breach is a fresh
  // ask. Reuses the resolver's floor and live price; a breach it can't
  // prove (no floor, or no quote) is omitted rather than asserted.
  const heldThroughFloor = new Map<string, HeldThroughFloor>();
  for (const t of theses) {
    const ht = load.declines.get(t.id);
    const r = resolved.get(t.id);
    const floorPrice = r?.ladderHealth?.floor?.price ?? null;
    const price = r?.currentPrice ?? null;
    if (!ht || floorPrice == null || price == null || price <= 0) continue;
    if (!(t.direction === "SHORT" ? price >= floorPrice : price <= floorPrice)) continue;
    heldThroughFloor.set(t.id, { floorPrice, heldThroughCount: ht.declineCount, rejectMessage: ht.rejectMessage, recentLow: load.recentLow.get(t.id) ?? null });
  }

  return { load, now, setupOverrides, needs, context, resolved, blocked, sources, heldThroughFloor };
}
