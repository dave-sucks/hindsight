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
import { backfillSignalFingerprint } from "@/lib/inngest/functions/backfill-signal-fingerprint";
import { pipelineCleanup } from "@/lib/inngest/functions/pipeline-cleanup";
import { housekeepingOverdueTheses } from "@/lib/inngest/functions/housekeeping-overdue-theses";
import { episodeTts } from "@/lib/inngest/functions/episode-tts";
import { podcastSegmentRun } from "@/lib/inngest/functions/podcast-segment-run";
// THESIS_RESEARCH_V2 Phase 1 — sub-agent dispatched by Principal Chat
// (and later Discovery / Daily / Tactical) to write one deep thesis.
import { thesisWriter } from "@/lib/inngest/functions/thesis-writer";
// Trade-as-Proposal — every 30 min during ET market hours, sweep
// Order(AWAITING_APPROVAL) rows past their expiresAt and flip them to
// EXPIRED. Cancels the paired PENDING_APPROVAL Position for OPEN intent
// and writes a PROPOSAL_EXPIRED ThesisUpdate so the agent reads it next
// run. See docs/plans/TRADE_AS_PROPOSAL.md.
import { proposalExpiry } from "@/lib/inngest/functions/proposal-expiry";

// Vercel function timeout for ALL Inngest functions served from this route.
// Set to the Vercel Pro plan's 800s ceiling because the heaviest paths
// (research-run at maxDuration:800, thesis-writer at maxDuration:800 post
// 2026-05-20) need every second of it. The shorter-mode functions (tactical
// 240s, discovery 270s, sync-heartbeat ~10s, etc.) don't pay anything for
// the higher ceiling — they return early.
//
// History:
//   • 2026-05-13: was 300 (Vercel Hobby ceiling). Discovery had to throttle
//     to maxDuration:270 to fit.
//   • 2026-05-15: research-run swap to gpt-5.5 + Vercel Pro upgrade →
//     modes.ts bumped research-run to 800 but THIS file was left at 300,
//     silently capping every Inngest path to 5 min.
//   • 2026-05-20: thesis-writer hit the 270s abort on a real refresh test
//     (synthesis + outer agent + record_thesis didn't fit). Bumped the
//     mode to 800 + this file to 800 in the same change.
export const maxDuration = 800;

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
    // 2026-06-01: intradayEodFlatten removed — no DAY-horizon analysts in
    // production; the auto-flatten cron had no consumers. Deleted as part
    // of the Trade-as-Proposal rollout (the proposal flow would have made
    // the cron's "auto-close at 15:45" semantic incompatible with the
    // approval gate anyway). See docs/plans/TRADE_AS_PROPOSAL.md §10 Step 13.

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
    // THESIS_RESEARCH_V2 Phase 1 — consumes app/thesis.write.requested
    // from dispatch_thesis_research, runs the focused sub-agent that
    // produces one deep-research thesis on one ticker, emits
    // app/thesis.written on completion. concurrency:5 inside the
    // function caps parallel fan-out for the Phase-2 Discovery rollout.
    thesisWriter,
    // Trade-as-Proposal — sweep AWAITING_APPROVAL Orders past their
    // expiresAt. See lib/inngest/functions/proposal-expiry.ts.
    proposalExpiry,
  ],
});
