// ── Trigger Evaluator ─────────────────────────────────────────────────────
// Two paths sharing one consumer (the pure `evaluateTrigger` function in
// lib/agent/triggers/evaluate.ts):
//
//   1. Signal-driven  — consumes `app/signal.routed`, evaluates each
//                       active+watching thesis on the signal's tickers
//                       against the signal's signal-side predicates.
//   2. Cron-driven    — every 15 min during US market hours, walks every
//                       ACTIVE thesis with non-empty triggers[], pulls
//                       latest Finnhub quote, evaluates price-side
//                       predicates.
//
// Both paths emit `app/thesis.trigger.fired` on match. The `lastFiredAt`
// cooldown stamp prevents same-trigger re-fires within cooldownDays.
//
// PR 2 boundary notes:
// - PRICE_MOVE_PCT and VS_SMA evaluate to false on the cron path because
//   we don't fetch candles or precompute SMA per cron tick — that's a real
//   tradeoff, documented in the doc. Daily run inline (PR 3) catches
//   cumulative-drift / SMA-cross with the candle data get_stock_data
//   already pulls.
// - RSI is stubbed in evaluate.ts; same reasoning.
// - Cooldown lives on the trigger object inside Thesis.triggers JSONB.
//   No schema change in PR 2. A separate TriggerFiring table is a
//   follow-up if hot-write contention shows up.

import { randomUUID } from "node:crypto";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { finnhub } from "@/lib/agent/research-helpers";
import { evaluateTrigger, shouldFire } from "@/lib/agent/triggers/evaluate";
import type { EvaluationContext } from "@/lib/agent/triggers/evaluate";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import type { Trigger, TriggerPredicate } from "@/lib/agent/triggers/types";

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Parse Thesis.triggers JSONB and validate against the Zod schema. On
 * invalid data, returns [] and logs — bad rows shouldn't crash the cron.
 */
function parseTriggers(raw: unknown, thesisId: string): Trigger[] {
  if (raw == null) return [];
  const result = triggersArraySchema.safeParse(raw);
  if (!result.success) {
    console.warn(
      `[trigger-evaluator] thesis=${thesisId} triggers JSON failed Zod validation`,
      result.error.flatten(),
    );
    return [];
  }
  // The schema's `id` .default() auto-generates an id for any trigger whose
  // stored JSON lacked one, so post-parse every trigger should have an id.
  // This map is a belt-and-suspenders backstop: if one still doesn't, assign
  // an id and log LOUDLY rather than silently dropping it. The old code
  // here silently filtered out id-less triggers, which hid the 2026-06-02
  // bug (agent-supplied trigger arrays persisted id-less because the schema
  // promised auto-generation it never did) for weeks — 25 of 30 theses,
  // including live MRVL/TSM stops, never fired. Never fail silent here again.
  return result.data.map((t): Trigger => {
    if (typeof t.id === "string" && t.id.length > 0) return t as Trigger;
    const id = randomUUID();
    console.error(
      `[trigger-evaluator] thesis=${thesisId} trigger missing id after schema parse — assigned ${id}. A write path bypassed triggerSchema; investigate.`,
    );
    return { ...t, id } as Trigger;
  });
}

/** Predicate kinds that can be evaluated without a Signal. */
function isPriceSidePredicate(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
    case "PRICE_MOVE_PCT":
    case "VS_SMA":
    case "RSI":
    case "TIME_ELAPSED":
    case "REVIEW_DATE_HIT":
      return true;
    case "AND":
    case "OR":
      return p.predicates.every(isPriceSidePredicate);
    default:
      return false;
  }
}

/** Predicate kinds that require a Signal in the context. */
function isSignalSidePredicate(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "SIGNAL_TYPE":
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
    case "GUIDANCE_CHANGE":
    case "FILING":
      return true;
    case "AND":
    case "OR":
      return p.predicates.some(isSignalSidePredicate);
    default:
      return false;
  }
}

/**
 * P1-14 — resolve the paired open Position's `openedAt` per ACTIVE thesis.
 *
 * TIME_ELAPSED on a HELD thesis must measure from when the position opened,
 * not when the (possibly much older) thesis row was created. We key the
 * position by (analystId, symbol, status=OPEN) — the same linkage every
 * close path uses, since there's no direct Thesis↔Position FK.
 *
 * Only ACTIVE theses are looked up; WATCHING rows keep their createdAt
 * clock and aren't queried. Returns a Map from thesisId → openedAt. A miss
 * (no open position found) simply leaves the thesis off the map, and the
 * evaluator falls back to createdAt — fail-soft, never throws.
 */
async function buildPositionOpenedAtMap(
  theses: Array<{
    id: string;
    ticker: string;
    status: string;
    researchRun: { agentConfigId: string | null };
  }>,
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  const active = theses.filter(
    (t) => t.status === "ACTIVE" && t.researchRun.agentConfigId != null,
  );
  if (active.length === 0) return out;

  // One findMany over the union of (analystId, symbol) pairs, then match
  // back per thesis. Over-fetches slightly (any OPEN position for these
  // analysts on these tickers) but keeps it to a single round-trip.
  const analystIds = Array.from(
    new Set(active.map((t) => t.researchRun.agentConfigId as string)),
  );
  const tickers = Array.from(new Set(active.map((t) => t.ticker)));
  const positions = await prisma.position.findMany({
    where: {
      analystId: { in: analystIds },
      symbol: { in: tickers },
      status: "OPEN",
    },
    select: { analystId: true, symbol: true, openedAt: true },
    orderBy: { openedAt: "desc" },
  });

  // Newest OPEN position per (analystId, symbol) wins — orderBy desc + first
  // write into the map.
  const byKey = new Map<string, Date>();
  for (const p of positions) {
    const key = `${p.analystId}::${p.symbol}`;
    if (!byKey.has(key)) byKey.set(key, p.openedAt);
  }
  for (const t of active) {
    const key = `${t.researchRun.agentConfigId}::${t.ticker}`;
    const openedAt = byKey.get(key);
    if (openedAt) out.set(t.id, openedAt);
  }
  return out;
}

interface FiringEvent {
  thesisId: string;
  triggerId: string;
  signalId?: string;
  analystId: string;
  ticker: string;
  action: Trigger["action"];
  predicateKind: TriggerPredicate["kind"];
}

/**
 * For one thesis × triggers[] × context, return all triggers that fire +
 * the updated triggers array with lastFiredAt stamped on the firing ones.
 * Pure read of `now`/`ctx` — no side effects.
 */
function evaluateThesisTriggers(args: {
  thesisId: string;
  triggers: Trigger[];
  ctx: EvaluationContext;
  predicateFilter?: (p: TriggerPredicate) => boolean;
}): { fires: Trigger[]; updatedTriggers: Trigger[] } {
  const fires: Trigger[] = [];
  const updatedTriggers = args.triggers.map((t) => {
    if (args.predicateFilter && !args.predicateFilter(t.predicate)) return t;
    const result = shouldFire(t, args.ctx);
    if (!result.fires) return t;
    fires.push(t);
    return {
      ...t,
      lastFiredAt: args.ctx.now.toISOString(),
    };
  });
  return { fires, updatedTriggers };
}

/**
 * Persist updated triggers JSON for a thesis in a single transaction.
 * Re-reads the row inside the tx so concurrent stamps don't trample each
 * other on non-overlapping triggers (e.g. signal-driven and cron firing
 * on the same thesis at the same time).
 */
async function stampLastFiredAt(args: {
  thesisId: string;
  firedTriggerIds: string[];
  now: Date;
}): Promise<void> {
  if (args.firedTriggerIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const row = await tx.thesis.findUnique({
      where: { id: args.thesisId },
      select: { triggers: true },
    });
    if (!row) return;
    const current = parseTriggers(row.triggers, args.thesisId);
    const stampSet = new Set(args.firedTriggerIds);
    const next = current.map((t) =>
      stampSet.has(t.id) ? { ...t, lastFiredAt: args.now.toISOString() } : t,
    );
    await tx.thesis.update({
      where: { id: args.thesisId },
      data: { triggers: next as unknown as object[] },
    });
  });
}

// ── Inngest function ────────────────────────────────────────────────────

export const triggerEvaluator = inngest.createFunction(
  {
    id: "trigger-evaluator",
    name: "Trigger Evaluator",
    concurrency: { limit: 2 },
    retries: 1,
  },
  [
    { event: "app/signal.routed" },
    // Bumped from */15 to */5 on 2026-05-07 to support DAY analysts.
    // Day-traders set absolute PRICE_ABOVE/PRICE_BELOW entry triggers on
    // intraday levels — at 15 min cadence the breakout has often failed
    // or run away by the time tactical-run spawns. 5 min is the floor for
    // "real-time enough to act on a breakout." Swing analysts unaffected
    // because per-trigger cooldowns prevent over-firing — a EXIT trigger
    // with cooldownDays=1 fires once whether the cron checks every 5 or
    // every 15 min. Cost: 3x Finnhub /quote calls per market hour, still
    // within the 200-unique-ticker cap and Finnhub paid-tier rate limits.
    { cron: "TZ=America/New_York */5 9-16 * * 1-5" },
  ],
  async ({ event, step }) => {
    const isSignalDriven = event?.name === "app/signal.routed";
    const now = new Date();

    // ── Signal-driven path ────────────────────────────────────────────
    if (isSignalDriven) {
      type Payload = { signalId: string; analystIds: string[]; tickers: string[] };
      const payload = (event?.data ?? {}) as Partial<Payload>;
      if (!payload.signalId || !payload.analystIds || payload.analystIds.length === 0) {
        return { skipped: "missing-payload", path: "signal-driven" };
      }

      const fires = await step.run("evaluate-signal", async () => {
        const signal = await prisma.signal.findUnique({
          where: { id: payload.signalId },
          select: {
            id: true,
            type: true,
            sentiment: true,
            urgency: true,
            tickers: true,
            dataPayload: true,
          },
        });
        if (!signal) return [] as FiringEvent[];

        // Load active+watching theses across the routed analysts that
        // cover any of the signal's tickers.
        const theses = await prisma.thesis.findMany({
          where: {
            researchRun: { agentConfigId: { in: payload.analystIds } },
            status: { in: ["ACTIVE", "WATCHING"] },
            ticker: { in: signal.tickers },
            triggers: { not: [] },
          },
          select: {
            id: true,
            ticker: true,
            status: true,
            triggers: true,
            createdAt: true,
            nextReviewAt: true,
            researchRun: { select: { agentConfigId: true } },
          },
        });

        // P1-14: for ACTIVE (held) theses, TIME_ELAPSED measures from the
        // paired position's openedAt, not the thesis row's createdAt. Look
        // up the open Position per (analyst, ticker) once for the ACTIVE
        // theses in this batch.
        const openedAtByThesisId = await buildPositionOpenedAtMap(theses);

        // Pull earnings / filing detail off Signal.dataPayload if the
        // producer stamped it. Producers may keep these in a {beat,
        // surprise, guidance, formType} shape on dataPayload — best-effort.
        const dp = (signal.dataPayload ?? {}) as Record<string, unknown>;
        const ctxSignal = {
          type: signal.type,
          sentiment: signal.sentiment,
          urgency: signal.urgency,
          tickers: signal.tickers,
          earningsSurprisePct: typeof dp.surprisePct === "number" ? dp.surprisePct : undefined,
          guidanceDirection:
            dp.guidanceDirection === "UP" || dp.guidanceDirection === "DOWN"
              ? (dp.guidanceDirection as "UP" | "DOWN")
              : undefined,
          filingFormType:
            typeof dp.formType === "string" &&
            ["10-K", "10-Q", "8-K", "FORM_4"].includes(dp.formType)
              ? (dp.formType as "10-K" | "10-Q" | "8-K" | "FORM_4")
              : undefined,
        };

        const events: FiringEvent[] = [];
        for (const thesis of theses) {
          // Skip theses whose research run isn't tied to an agent config —
          // tactical-run can't dispatch without an analyst owner.
          const analystId = thesis.researchRun.agentConfigId;
          if (!analystId) continue;

          const triggers = parseTriggers(thesis.triggers, thesis.id);
          if (triggers.length === 0) continue;

          const ctx: EvaluationContext = {
            signal: ctxSignal,
            thesis: {
              createdAt: thesis.createdAt,
              nextReviewAt: thesis.nextReviewAt,
              status: thesis.status,
              positionOpenedAt: openedAtByThesisId.get(thesis.id) ?? null,
            },
            now,
          };

          const { fires } = evaluateThesisTriggers({
            thesisId: thesis.id,
            triggers,
            ctx,
            predicateFilter: isSignalSidePredicate,
          });

          if (fires.length === 0) continue;
          await stampLastFiredAt({
            thesisId: thesis.id,
            firedTriggerIds: fires.map((t) => t.id),
            now,
          });
          for (const t of fires) {
            events.push({
              thesisId: thesis.id,
              triggerId: t.id,
              signalId: signal.id,
              analystId,
              ticker: thesis.ticker,
              action: t.action,
              predicateKind: t.predicate.kind,
            });
          }
        }
        return events;
      });

      // Fan out one event per firing.
      for (const f of fires) {
        await step.sendEvent(`fired-${f.thesisId}-${f.triggerId}`, {
          name: "app/thesis.trigger.fired",
          data: f,
        });
      }

      return {
        path: "signal-driven",
        signalId: payload.signalId,
        firings: fires.length,
      };
    }

    // ── Cron path (intraday price reactivity) ──────────────────────────
    const cronFires = await step.run("evaluate-cron", async () => {
      // ACTIVE + WATCHING. ACTIVE theses have positions at risk (stop /
      // target / trail). WATCHING theses carry promotion triggers — for
      // day-traders especially, the morning playbook mints WATCHING
      // theses with PRICE_ABOVE/PRICE_BELOW entry triggers; without
      // cron-path evaluation those triggers would never fire intraday.
      // The 200-ticker cap below still bounds the loop. Signal-router
      // continues to handle signal-side predicates on both statuses.
      const theses = await prisma.thesis.findMany({
        where: {
          status: { in: ["ACTIVE", "WATCHING"] },
          triggers: { not: [] },
        },
        select: {
          id: true,
          ticker: true,
          status: true,
          triggers: true,
          createdAt: true,
          nextReviewAt: true,
          researchRun: { select: { agentConfigId: true } },
        },
      });
      if (theses.length === 0) return [] as FiringEvent[];

      // P1-14: anchor TIME_ELAPSED to the paired position's openedAt for
      // ACTIVE (held) theses. WATCHING rows stay on createdAt.
      const openedAtByThesisId = await buildPositionOpenedAtMap(theses);

      // Cap unique tickers per tick to bound Finnhub calls. 200 mirrors
      // the signal-router cap. Theses past the cap defer to the next tick.
      const uniqueTickers = Array.from(new Set(theses.map((t) => t.ticker))).slice(0, 200);
      const quoteResults = await Promise.all(
        uniqueTickers.map(async (ticker) => {
          const r = await finnhub(`/quote?symbol=${ticker}`, 1);
          const q = r.data as Record<string, number> | null;
          if (!q || typeof q.c !== "number" || q.c <= 0) {
            return [ticker, null] as const;
          }
          return [ticker, { price: q.c, changePct: q.dp ?? 0 }] as const;
        }),
      );
      const quoteByTicker = new Map(quoteResults);

      const events: FiringEvent[] = [];
      for (const thesis of theses) {
        // Skip theses whose research run isn't tied to an agent config —
        // tactical-run can't dispatch without an analyst owner.
        const analystId = thesis.researchRun.agentConfigId;
        if (!analystId) continue;

        const triggers = parseTriggers(thesis.triggers, thesis.id);
        if (triggers.length === 0) continue;
        const latestQuote = quoteByTicker.get(thesis.ticker) ?? undefined;

        const ctx: EvaluationContext = {
          // No signal on this path. PRICE_MOVE_PCT / VS_SMA / RSI return
          // false because we don't pass recentPrices / sma here — see
          // the file-header note for the rationale.
          latestQuote: latestQuote ?? undefined,
          thesis: {
            createdAt: thesis.createdAt,
            nextReviewAt: thesis.nextReviewAt,
            status: thesis.status,
            positionOpenedAt: openedAtByThesisId.get(thesis.id) ?? null,
          },
          now,
        };

        const { fires } = evaluateThesisTriggers({
          thesisId: thesis.id,
          triggers,
          ctx,
          predicateFilter: isPriceSidePredicate,
        });

        if (fires.length === 0) continue;
        await stampLastFiredAt({
          thesisId: thesis.id,
          firedTriggerIds: fires.map((t) => t.id),
          now,
        });
        for (const t of fires) {
          events.push({
            thesisId: thesis.id,
            triggerId: t.id,
            analystId,
            ticker: thesis.ticker,
            action: t.action,
            predicateKind: t.predicate.kind,
          });
        }
      }
      return events;
    });

    for (const f of cronFires) {
      await step.sendEvent(`fired-${f.thesisId}-${f.triggerId}`, {
        name: "app/thesis.trigger.fired",
        data: f,
      });
    }

    return {
      path: "cron",
      firings: cronFires.length,
    };
  },
);

// Re-exports for tests that want to exercise the predicate filters
// directly without standing up Inngest.
export const __test__ = {
  isPriceSidePredicate,
  isSignalSidePredicate,
  parseTriggers,
  evaluateThesisTriggers,
  evaluateTrigger,
};
