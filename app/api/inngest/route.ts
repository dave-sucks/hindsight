import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { priceMonitor } from "@/lib/inngest/functions/price-monitor";
import { reconcileOrders } from "@/lib/inngest/functions/reconcile-orders";
import { syncHeartbeat } from "@/lib/inngest/functions/sync-heartbeat";
import { evaluateTrade } from "@/lib/inngest/functions/trade-evaluator";
import { morningResearch } from "@/lib/inngest/functions/morning-research";
import { eodEvaluation } from "@/lib/inngest/functions/eod-evaluation";
import { dailyRunDigest } from "@/lib/inngest/functions/daily-run-digest";
import { accuracyScorer } from "@/lib/inngest/functions/accuracy-scorer";
// V3 Intelligence Layer
import { firmMarketSweep } from "@/lib/inngest/functions/firm-market-sweep";
import { portfolioWatchlistMonitor } from "@/lib/inngest/functions/portfolio-watchlist-monitor";
import { domainMonitor } from "@/lib/inngest/functions/domain-monitor";
import { signalRouter } from "@/lib/inngest/functions/signal-router";
import { triggerEvaluator } from "@/lib/inngest/functions/trigger-evaluator";
import { tacticalRun } from "@/lib/inngest/functions/tactical-run";
import { discoveryRun } from "@/lib/inngest/functions/discovery-run";
import { intradayEodFlatten } from "@/lib/inngest/functions/intraday-eod-flatten";
import { backfillSignalFingerprint } from "@/lib/inngest/functions/backfill-signal-fingerprint";
import { pipelineCleanup } from "@/lib/inngest/functions/pipeline-cleanup";
import { housekeepingOverdueTheses } from "@/lib/inngest/functions/housekeeping-overdue-theses";
import { episodeTts } from "@/lib/inngest/functions/episode-tts";
import { podcastSegmentRun } from "@/lib/inngest/functions/podcast-segment-run";

// All Inngest-backed agent runs (morning-research, discovery, tactical,
// podcast-segment) execute their generateText calls inside this single
// route handler. The Vercel function timeout here is the HARD ceiling —
// no AbortSignal in agent code can extend past it. Per-mode budgets in
// lib/agent/modes.ts.maxDuration drive the in-code AbortSignal but they
// cannot override this number.
//
// 2026-05-15 — raised 300 → 600.
//
// Reason: GPT-5.5 with implicit reasoning takes ~13s per tool call vs
// GPT-4o's ~3-5s. Tech Momentum discovery (cmp698wva...) made 16 tool
// calls in 211s before hitting the prior 240s AbortSignal — but ALSO,
// even with PR #271 raising the AbortSignal budget to 480s, the Vercel
// 300s ceiling here would have killed the function anyway. Both have
// to move together. 600s gives the agent comfortable headroom for the
// largest discovery runs (16-20 mints + summary + complete).
//
// Vercel Pro tier supports maxDuration up to 900s. If we ever need
// more, that's the cap.
export const maxDuration = 600; // 10 min — covers multi-step agent runs

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Existing
    priceMonitor,
    reconcileOrders,
    // Hourly Alpaca↔DB drift detector. Writes one SyncHealthSnapshot row per run.
    // Restored 2026-05-11 after PR #238 deleted it — see /intelligence Health tab.
    syncHeartbeat,
    evaluateTrade,
    morningResearch,
    eodEvaluation,
    // 10 AM ET Mon-Fri — per-owner digest of every analyst's morning activity
    // (new positions, closed positions, material thesis changes). Trade-opened
    // and trade-closed alerts fire immediately per-trade; this is the daily
    // roll-up scan-at-a-glance.
    dailyRunDigest,
    accuracyScorer,
    // V3 Intelligence (run in order: 6:30 → 7:00 → 7:15 → 7:30 → 7:45 → 8:00 analyst runs)
    firmMarketSweep,
    portfolioWatchlistMonitor,
    domainMonitor,
    signalRouter,
    // PR 2 — consumes `app/signal.routed` from signalRouter and runs a
    // 15-min cron during US market hours. Emits `app/thesis.trigger.fired`
    // on match.
    triggerEvaluator,
    // PR 2 — consumes `app/thesis.trigger.fired`. Spawns a focused agent
    // run scoped to one (thesis, trigger, signal?) tuple. The actual
    // tactical agent runs INSIDE the function (mode='INTRADAY_TACTICAL'
    // on ResearchRun). 240s maxDuration covers the agent + bookkeeping.
    tacticalRun,
    // PR 3 — weekly discovery cron, Sundays 9am ET. Spawns a focused
    // agent run per analyst that scans the past week of signals for
    // net-new ticker coverage and mints WATCHING theses. Does NOT
    // touch existing theses (the daily run handles those).
    discoveryRun,
    // DAY-only analysts: 15:45 ET cron force-closes any open positions
    // before the 16:00 market close. System rule, not an LLM decision —
    // a DAY analyst going home with an open position is a config violation.
    intradayEodFlatten,
    // 2026-04-30: morningBriefGenerator removed. The agent reads durable
    // state (theses, triggers fired since last run, today's signals)
    // directly via tools — no need for a synthesized AI digest.
    // One-shot Session 2 backfill (event-triggered, idempotent)
    backfillSignalFingerprint,
    // Phase 3 — daily pruning at 11 PM ET (route archive + signal soft-delete)
    pipelineCleanup,
    // Hourly safety net (US market hours): writes a synthetic
    // TRIGGER_FIRED row for every ACTIVE/WATCHING thesis whose
    // nextReviewAt is in the past, with a 24h per-thesis cooldown.
    // Surfaces in the next Daily Run via triggersFiredSinceLastRun.
    housekeepingOverdueTheses,
    // Podcast Phase 2 — ElevenLabs TTS audio generation
    episodeTts,
    // Podcast — server-side segment run (used by "Run all")
    podcastSegmentRun,
  ],
});
