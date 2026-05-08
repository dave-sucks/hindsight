import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { priceMonitor } from "@/lib/inngest/functions/price-monitor";
import { reconcileOrders } from "@/lib/inngest/functions/reconcile-orders";
import { evaluateTrade } from "@/lib/inngest/functions/trade-evaluator";
import { morningResearch } from "@/lib/inngest/functions/morning-research";
import { eodEvaluation } from "@/lib/inngest/functions/eod-evaluation";
import { weeklyDigest } from "@/lib/inngest/functions/weekly-digest";
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

// morning-research runs a full agent (generateText with 30 tool steps)
// inside a single step.run — needs extended timeout to avoid Vercel killing it
export const maxDuration = 300; // 5 min — covers multi-step agent runs

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Existing
    priceMonitor,
    reconcileOrders,
    evaluateTrade,
    morningResearch,
    eodEvaluation,
    weeklyDigest,
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
