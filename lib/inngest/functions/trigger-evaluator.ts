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
// - PRICE_MOVE_PCT: the 1D window (the "Movement Amount" daily-move alert)
//   DOES fire on the cron — it evaluates off the quote's daily % change
//   (latestQuote.changePct, derived from Finnhub dp / prior close below). The
//   multi-day windows (5D/30D) still evaluate to false here because we don't
//   fetch candles per tick; the daily-run inline path catches those with the
//   candle data get_stock_data already pulls. VS_SMA likewise needs candles
//   and stays false on the cron.
// - RSI is stubbed in evaluate.ts; same reasoning.
// - Cooldown lives on the trigger object inside Thesis.triggers JSONB.
//   No schema change in PR 2. A separate TriggerFiring table is a
//   follow-up if hot-write contention shows up.

import { randomUUID } from "node:crypto";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import {
  finnhub,
  quoteAgeMs,
  STALE_QUOTE_THRESHOLD_MS,
} from "@/lib/agent/research-helpers";
import { evaluateTrigger, shouldFire } from "@/lib/agent/triggers/evaluate";
import type { EvaluationContext } from "@/lib/agent/triggers/evaluate";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import type { Trigger, TriggerPredicate } from "@/lib/agent/triggers/types";
import { describeTriggerFire } from "@/lib/agent/triggers/format";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { isMarketOpen } from "@/lib/market-hours";

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
    case "GAIN_FROM_ENTRY":
    case "TRAILING_FROM_HIGH":
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
interface PositionInfo {
  openedAt: Date;
  /** For GAIN_FROM_ENTRY — entry economics of the open position. */
  avgCost: number | null;
  /** For TRAILING_FROM_HIGH — price-monitor-maintained water mark. */
  peakPrice: number | null;
}

async function buildPositionOpenedAtMap(
  theses: Array<{
    id: string;
    ticker: string;
    status: string;
    researchRun: { agentConfigId: string | null };
  }>,
): Promise<Map<string, PositionInfo>> {
  const out = new Map<string, PositionInfo>();
  const active = theses.filter(
    (t) =>
      (t.status === "HOLDING") &&
      t.researchRun.agentConfigId != null,
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
    select: {
      analystId: true,
      symbol: true,
      openedAt: true,
      avgCost: true,
      peakPrice: true,
    },
    orderBy: { openedAt: "desc" },
  });

  // Newest OPEN position per (analystId, symbol) wins — orderBy desc + first
  // write into the map.
  const byKey = new Map<string, PositionInfo>();
  for (const p of positions) {
    const key = `${p.analystId}::${p.symbol}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        openedAt: p.openedAt,
        avgCost: p.avgCost,
        peakPrice: p.peakPrice,
      });
    }
  }
  for (const t of active) {
    const key = `${t.researchRun.agentConfigId}::${t.ticker}`;
    const info = byKey.get(key);
    if (info) out.set(t.id, info);
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
            // enabled:true — never fire triggers for a disabled analyst. The
            // signal path is already scoped to router-supplied analystIds (the
            // router filters enabled), but we filter here too for defense in
            // depth against a mid-flight disable. See OPENAI_COST_REDUCTION.md.
            researchRun: {
              agentConfigId: { in: payload.analystIds },
              agentConfig: { enabled: true },
            },
            status: { in: ["HOLDING", "WATCHING"] },
            ticker: { in: signal.tickers },
            triggers: { not: [] },
          },
          select: {
            id: true,
            ticker: true,
            status: true,
            direction: true,
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

          const posInfo = openedAtByThesisId.get(thesis.id);
          const ctx: EvaluationContext = {
            signal: ctxSignal,
            thesis: {
              createdAt: thesis.createdAt,
              nextReviewAt: thesis.nextReviewAt,
              status: thesis.status,
              positionOpenedAt: posInfo?.openedAt ?? null,
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
            // REVIEW-batching: a REVIEW trigger means "re-evaluate this
            // thesis," not "act now" — it converts to a trade ~4-8% of the
            // time, so it does not warrant a dedicated GPT-5 tactical run.
            // Instead write the TRIGGER_FIRED audit row HERE (tactical-run.ts
            // used to write it on spawn) so the next daily run surfaces it as
            // needsAction=TRIGGER_FIRED and reviews it in-batch — which can
            // still buy / sell / stop-watch / mark-reviewed. The daily run is
            // needsAction-gated (it skips unflagged theses), so this write is
            // load-bearing: without it a transient REVIEW that no longer
            // matches by morning would be silently dropped. BREAKING-urgency
            // reviews still spawn (a real catalyst can't wait for tomorrow);
            // ENTER/EXIT always spawn. See OPENAI_COST_REDUCTION.md #2.
            const deferToDaily =
              t.action === "REVIEW" && ctxSignal.urgency !== "BREAKING";
            if (deferToDaily) {
              await writeThesisUpdate({
                thesisId: thesis.id,
                type: "TRIGGER_FIRED",
                summary: `${describeTriggerFire(t)} — deferred to the next daily review`,
                rationale: t.rationale,
                triggerId: t.id,
                signalIds: [signal.id],
                runId: null,
              });
              continue;
            }
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
    // Only evaluate price predicates during the regular session. The cron
    // schedule (*/5 9-16) also covers the 9:00–9:25 pre-open ticks, the
    // post-4:00 ticks, and holidays — and pre/after-hours quotes are thin and
    // erratic, so a "down X% on the day" trigger can fire on a pre-market print
    // (observed: a 1% movement trigger fired at 9:00 AM). Gate on isMarketOpen()
    // (9:30–16:00 ET, holiday-aware) — the same guard price-monitor already
    // uses. The signal-driven path above is intentionally NOT gated: news
    // doesn't keep market hours.
    const marketOpen = await step.run("check-market-hours", async () =>
      isMarketOpen(),
    );
    if (!marketOpen) {
      return { path: "cron", skipped: "market-closed" };
    }

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
          // enabled:true — kill the zombie: a disabled analyst's HOLDING/
          // WATCHING thesis must not fire intraday triggers. This was the
          // EV Catalyst (ON) tactical that kept firing daily post-disable.
          // The cron path (unlike the signal path) had no enabled gate.
          // See OPENAI_COST_REDUCTION.md.
          researchRun: { agentConfig: { enabled: true } },
          status: { in: ["HOLDING", "WATCHING"] },
          triggers: { not: [] },
        },
        select: {
          id: true,
          ticker: true,
          status: true,
          direction: true,
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
          // Observability only — this does NOT suppress firing. A stale price
          // is fail-unsafe in both directions (act on it and a stop fires at
          // the wrong level; skip it and the stop doesn't fire at all), so the
          // evaluator still scores the quote and we make the staleness loud
          // instead. See the 2026-08-14 stale-quote bug.
          const age = quoteAgeMs(q);
          if (age != null && age > STALE_QUOTE_THRESHOLD_MS) {
            console.warn(
              `[trigger-evaluator] STALE QUOTE ${ticker}: ${Math.round(age / 60_000)}min old (price ${q.c}) — evaluating anyway`,
            );
          }
          // Daily % change vs prior close. Prefer Finnhub's `dp`, but fall back
          // to computing it from `pc` (prior close) when `dp` is missing —
          // thin/ADR names often omit `dp`, and silently coercing to 0% would
          // make a Movement-Amount STOP never fire on exactly those names
          // (fail-unsafe for a stop). Only 0 when we genuinely can't tell.
          const changePct =
            typeof q.dp === "number"
              ? q.dp
              : typeof q.pc === "number" && q.pc > 0
                ? ((q.c - q.pc) / q.pc) * 100
                : 0;
          return [ticker, { price: q.c, changePct }] as const;
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

        const posInfo = openedAtByThesisId.get(thesis.id);
        const ctx: EvaluationContext = {
          // No signal on this path. Multi-day PRICE_MOVE_PCT / VS_SMA /
          // RSI return false because we don't pass recentPrices / sma
          // here — see the file-header note for the rationale.
          latestQuote: latestQuote ?? undefined,
          // GAIN_FROM_ENTRY + TRAILING_FROM_HIGH read the open position's
          // entry cost + water mark; absent (WATCHING) → they return false.
          position: posInfo
            ? { avgCost: posInfo.avgCost, peakPrice: posInfo.peakPrice }
            : null,
          thesis: {
            createdAt: thesis.createdAt,
            nextReviewAt: thesis.nextReviewAt,
            status: thesis.status,
            direction: thesis.direction,
            positionOpenedAt: posInfo?.openedAt ?? null,
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
          // REVIEW-batching (see the signal path for the full rationale).
          // Cron-path REVIEWs carry no signal/urgency, so every REVIEW defers
          // to the daily run: write the TRIGGER_FIRED audit row (stamped with
          // the price that fired it) and skip the tactical spawn. The daily
          // run picks it up via needsAction=TRIGGER_FIRED. ENTER/EXIT/stop
          // triggers still spawn a tactical. See OPENAI_COST_REDUCTION.md #2.
          if (t.action === "REVIEW") {
            await writeThesisUpdate({
              thesisId: thesis.id,
              type: "TRIGGER_FIRED",
              summary: `${describeTriggerFire(t)} — deferred to the next daily review`,
              rationale: t.rationale,
              triggerId: t.id,
              signalIds: [],
              runId: null,
              priceAtTime: latestQuote?.price ?? null,
            });
            continue;
          }
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
