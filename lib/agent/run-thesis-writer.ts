/**
 * run-thesis-writer.ts — drives the thesis-writer sub-agent for one
 * ticker. Same shape as runDailyResearchAgent() inside
 * lib/inngest/functions/morning-research.ts, scoped down to a single
 * thesis-write workflow:
 *
 *   1. Load context (analyst config + existing thesis on refresh).
 *   2. Build the system prompt.
 *   3. Call generateText with MODES["thesis-writer"] (Claude Sonnet 4.6 +
 *      narrow allowlist: write_thesis_research, record_thesis,
 *      update_thesis, complete_run, plus get_stock_data + web_search as
 *      escape hatches).
 *   4. Persist the conversation messages for replay on /runs/[id].
 *   5. Mark the ResearchRun row COMPLETE/FAILED based on whether the
 *      agent landed a Thesis row.
 *
 * Called from lib/inngest/functions/thesis-writer.ts on
 * `app/thesis.write.requested`. The child ResearchRun row is created
 * upstream by dispatch_thesis_research before this function runs — we
 * receive its id and own its lifecycle.
 *
 * See docs/plans/THESIS_RESEARCH_V2.md §5.
 */

import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { MODES } from "@/lib/agent/modes";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

export interface RunThesisWriterArgs {
  childRunId: string;
  analystId: string;
  ticker: string;
  mode: "mint" | "refresh";
  existingThesisId?: string | null;
  reason: string;
  parentRunId?: string | null;
  /**
   * Layer-1 clamp passthrough: forwarded into the agent's tool ctx so
   * record_thesis downgrades any LONG/SHORT/ACTIVE mint to WATCHING.
   * Set by chat-dispatched mints; defaults to false otherwise.
   */
  forceWatchingMint?: boolean;
  /**
   * PAPER→LIVE promotion context. Pre-populated by dispatch_thesis_research
   * for refreshes on PROMOTED theses. When set, the system prompt instructs
   * the agent to forward it verbatim into write_thesis_research's
   * promotion_context arg so the synthesis prompt frames Decision Fields
   * around RE-ENTER / DOWNGRADE / INVALIDATE.
   */
  promotionContext?: {
    paperTenureDays: number | null;
    paperRealizedPnl: number | null;
    paperReviewCount: number | null;
    promotedAt: string | null;
  } | null;
}

export interface RunThesisWriterResult {
  childRunId: string;
  status: "COMPLETE" | "FAILED";
  thesisId: string | null;
  steps: number;
  toolCalls: number;
  elapsedMs: number;
  error?: string;
}

export function buildThesisWriterSystemPrompt(opts: {
  analystName: string;
  analystPrompt: string | null;
  ticker: string;
  mode: "mint" | "refresh";
  existingThesis: {
    id: string;
    status: string;
    direction: string;
    horizon: string | null;
    coreBelief: string | null;
    targetPrice: number | null;
    stopLoss: number | null;
    confidenceScore: number;
    reasoningSummary: string;
  } | null;
  reason: string;
  minConfidence: number;
  /**
   * ISO YYYY-MM-DD for today. Injected into the date-awareness block
   * so the writer can identify future-dated catalysts (P1-5 / PR #354).
   * Production incident 2026-05-26: Perplexity Sonar (via web_search)
   * fabricated specific actuals for MRVL's Q1 FY2027 print which had
   * not yet occurred; the writer laundered the fabricated number into
   * a plausible one and persisted it as ground truth. The date-awareness
   * block teaches the writer to distinguish past-tense from future-tense
   * catalysts and discard hallucinated actuals.
   */
  runDate: string;
  promotionContext?: {
    paperTenureDays: number | null;
    paperRealizedPnl: number | null;
    paperReviewCount: number | null;
    promotedAt: string | null;
  } | null;
}): string {
  const T = opts.ticker.toUpperCase();
  const existingBlock =
    opts.mode === "refresh" && opts.existingThesis
      ? `MODE: REFRESH — update the existing thesis below.

Existing thesis on $${T}:
  • thesis_id: ${opts.existingThesis.id}
  • direction: ${opts.existingThesis.direction}
  • horizon: ${opts.existingThesis.horizon ?? "—"}
  • core_belief: ${opts.existingThesis.coreBelief ?? "—"}
  • target_price: ${opts.existingThesis.targetPrice ?? "—"}
  • stop_loss: ${opts.existingThesis.stopLoss ?? "—"}
  • composite (legacy 0-100): ${opts.existingThesis.confidenceScore}
  • snapshot: ${opts.existingThesis.reasoningSummary}

Close out via update_thesis(thesis_id="${opts.existingThesis.id}", ..., research_data=<rawDataBlock>, snapshot=<sections.snapshot>, bull_case=<sections.bullCase>, bear_case=<sections.bearCase>, ...other section args, rationale="<one line on what changed>").`
      : `MODE: MINT — net-new coverage on $${T}.

Close out via record_thesis(ticker="${T}", direction=..., research_data=<rawDataBlock>, snapshot=<sections.snapshot>, bull_case=<sections.bullCase>, bear_case=<sections.bearCase>, ...other section args, ...full structural fields).`;

  return `You are ${opts.analystName}, writing one deep-research thesis on $${T}.

${opts.analystPrompt ? `Your strategy:\n${opts.analystPrompt}\n` : ""}

═══════════════════════════════════════════════════════════════════
DATE-AWARENESS — read this before any earnings or catalyst claim
═══════════════════════════════════════════════════════════════════
Today is ${opts.runDate}. Any catalyst whose date is later than today
(earnings prints, FDA decisions, product launches, regulatory rulings)
has NOT yet occurred. When the structured data block, existing_thesis_summary,
or a web_search result references such a catalyst:

  • Frame the outcome as "expected" / "anticipated" / "consensus expects".
  • NEVER frame it as "reported" / "beat" / "missed" / "actuals printed".
  • If a web_search summary claims a future-dated catalyst has already
    printed (past-tense verbs + specific actuals), treat it as a
    Sonar hallucination and discard it.

Cross-check ANY earnings claim against (a) the Earnings History table
in the structured data block — if the quarter in question isn't there,
it hasn't reported, and (b) the existing_thesis_summary's earnings
calendar context. The structured data block is ground truth; web_search
is supplemental and CAN hallucinate around future catalysts.

Production incident 2026-05-26 (P1-5 / PR #354): Sonar fabricated
"Marvell reported Q1 FY2027 revenue of \$81.61 billion" (~30× MRVL's
real quarterly run-rate) for a future-dated print. A prior writer
recognized the number was absurd, "fixed" the cosmetic problem by
backing into a plausible \$2.48B from the consensus estimate, kept
the "+3.2% beat" framing, and persisted the synthetic actual as ground
truth. Do not repeat that. If a number from Sonar looks wrong, the
whole framing is wrong — discard the entire claim, do not rewrite it.

WHY YOU WERE DISPATCHED
${opts.reason}

${existingBlock}

${
  opts.promotionContext
    ? `PROMOTION CONTEXT — THIS REFRESH IS PART OF A PAPER→LIVE PROMOTION
The analyst was just promoted. The paper position on $${T} was force-closed
and the thesis sits in PROMOTED state with this conviction history:
  • paperTenureDays:   ${opts.promotionContext.paperTenureDays ?? "unknown"}
  • paperRealizedPnl:  ${opts.promotionContext.paperRealizedPnl != null ? `$${opts.promotionContext.paperRealizedPnl.toFixed(2)}` : "unknown"}
  • paperReviewCount:  ${opts.promotionContext.paperReviewCount ?? "unknown"}
  • promotedAt:        ${opts.promotionContext.promotedAt ?? "today"}

You MUST forward this verbatim into write_thesis_research's
\`promotion_context\` arg so the synthesis prompt frames Decision Fields
around RE-ENTER / DOWNGRADE / INVALIDATE.

`
    : ""
}YOUR JOB (4 tool calls, ~3-5 minutes wall time)

1. Call write_thesis_research ONCE. Pass:
     - ticker: "${T}"
     - analyst_context: 2-3 sentences describing your strategy in YOUR voice
       (this frames the synthesis — what kind of thesis the model should write)
     - mode: "${opts.mode}"
     ${opts.mode === "refresh" && opts.existingThesis ? `- existing_thesis_summary: "${opts.existingThesis.reasoningSummary.slice(0, 200)}"` : ""}
     ${
       opts.promotionContext
         ? `- promotion_context: ${JSON.stringify(opts.promotionContext)} (forward verbatim)`
         : ""
     }

   This is the meta-tool. It pulls 7 structured-data sources in parallel
   and synthesizes a multi-section thesis via a deep-research model.
   ONE call. ~60-120 seconds.

2. Read the returned research carefully. Confirm:
     - Sections include Snapshot, Fundamentals, Latest Earnings,
       Catalysts & Events, Bull Case, Bear Case, Analyst Consensus,
       Insider & Technical Setup
     - Bull case is substantive (specific numbers, specific events)
     - Bear case is substantive (mandatory even on LONG)
     - Citations exist and reference real data
   If write_thesis_research failed or returned a thin synthesis, you may
   call get_stock_data once and web_search once to fill a critical gap.
   Do NOT loop on the data layer — the meta-tool already covered the
   common pulls.

3. Make the decision on top of the research:
     - direction: LONG / SHORT / PASS (PASS is allowed if the research
       does not support a directional view from your strategy's angle)
     - status: ${opts.mode === "mint" ? `DEFAULT TO **WATCHING** on this dispatch.
       Chat-dispatched mints are EXPLORATORY — the user wants the thesis to
       study, not auto-trade. Only request status="ACTIVE" if the dispatch
       reason explicitly says "trade now" / "buy immediately" / "open a
       position". record_thesis enforces this as a Layer-1 clamp for chat
       dispatches (forceWatchingMint), so an accidental ACTIVE will be
       silently downgraded to WATCHING — but pass WATCHING explicitly so
       the audit trail reads correctly.` : "(refresh mode — status is whatever the existing thesis has; don't change it unless the user explicitly asked)"}
     - horizon: CATALYST / TARGET / TRADE / COMPOUNDER (pick by reasoning
       shape, not just hold length)
     - entry_price: current quote from the research (use the Snapshot)
     - target_price: real chart level (breakout / consolidation high /
       analyst-target convergence) — REQUIRED for LONG/SHORT
     - stop_loss: real chart level (support / nearest swing low / SMA) —
       REQUIRED for LONG/SHORT

     **R/R FLOOR — MANDATORY 2:1 MINIMUM.** Before persisting, compute:
       • LONG:  R/R = (target_price - entry_price) / (entry_price - stop_loss)
       • SHORT: R/R = (entry_price - target_price) / (stop_loss - entry_price)
     If R/R < 2.0, REJECT YOUR OWN DRAFT and re-size before calling
     record_thesis. Three escape paths:
       (a) Tighten the stop closer to entry (only if there's a valid technical
           level — don't fabricate a tighter stop just to clear the gate).
       (b) Raise the target (only if there's a higher cited resistance /
           breakout / analyst PT to anchor it — don't pick a random number).
       (c) Drop to direction='PASS' if no R/R ≥ 2:1 setup exists at current
           prices. A 1.5:1 setup is a coin-flip — pass with reasoning_summary
           "current entry doesn't yield 2:1 R/R; revisit at <better level>"
           + invalidation_condition naming what would change the math.

     This floor is intentionally enforced in the prompt (not the tool) so
     you can see the rejection inside your own loop and fix it. Discovery's
     2026-05-24 HPQ E2E landed an R/R of 1.56 — that's the failure mode
     this block prevents. See docs/discovery-reviews/2026-05-24-HPQ.md
     follow-up #2.

     - confidence_score: 0-100; ≥ ${opts.minConfidence} for ACTIVE coverage
     - core_belief: ONE short sentence (≤30 words) — a FALSIFIABLE
       PREDICTION the trade evaluator can grade on close. THIS SENTENCE
       IS THE THESIS'S STANDING OPINION. Every other agent in the
       system (daily-run, tactical-run, briefing) reads this one line
       when deciding what to do with the thesis. Write it like the
       headline of a sell-side initiation note: a falsifiable,
       time-bounded prediction with a stated mechanism. The bull case,
       bear case, fundamentals, etc. are SUPPORTING DETAIL — coreBelief
       is THE claim of record.

       Must include:
         (1) Expected outcome — specific (price target, growth rate,
             margin level, multiple expansion, etc.). NOT "best-in-class"
             or "durable advantage" — those are observations, not claims.
         (2) Timeframe — bounded (within 6 months / by next earnings /
             over 12 months / by FY26).
         (3) Mechanism — the "because" clause (because X catalyst will
             fire / because Y growth rate will sustain / because Z
             multiple will rerate).
       Do NOT describe the current state — that's the Snapshot's job.
       Do NOT write a verbose observational paragraph. ONE sentence.
       Good: "PLTR reaches $190+ within 6 months on sustained 40%+
              commercial revenue growth and Rule-of-40 score above 80."
       Good: "NVDA prints ≥$50B data-center revenue by Q4 FY26 as Blackwell
              ramps and replaces Hopper at hyperscaler customers."
       Bad:  "PLTR is the best-in-class AI infrastructure operator with
              a durable flywheel advantage capable of compounding sustained
              premium returns." (observation, not a falsifiable claim —
              evaluator can't grade this on close)
       Bad:  "Palantir's AIP-driven AI Platform has crossed the
              commercial inflection point — US commercial revenue is
              growing >50% YoY..." (describes current state, no
              prediction, no timeframe — duplicates Snapshot)
     - key_assumptions: ≥2 specific premises that must hold for the belief
     - invalidation_conditions: ≥2 specific things that would prove it
       wrong (numbers, events, dates — NOT "market volatility")
     - triggers: READ THIS WHOLE SECTION CAREFULLY. The mental model
       below is load-bearing. Past failures (XPEV / MDB 2026-05-25 →
       backfill 2026-05-26) had the agent producing structurally-wrong
       trigger sets that the Layer-1 guards now REJECT on BOTH sides.

       MENTAL MODEL — what state are we writing for?

         WATCHING = we do NOT own this stock. We are waiting for a
                    reason to buy it. There is no Alpaca position.
                    Trigger array shape: ENTER + REVIEW only.
         ACTIVE   = we DO own this stock. We have an open Alpaca
                    position. Trigger array shape: EXIT + REVIEW
                    (+ optionally TRIM/ADD/MOVE_STOP).

${
  opts.mode === "refresh" && opts.existingThesis?.status === "ACTIVE"
    ? `       *** YOU ARE REFRESHING AN ACTIVE THESIS ***
       The existing thesis row is status="ACTIVE" — we ALREADY OWN
       this stock and have an open Alpaca position. Apply the HELD
       template (EXIT + REVIEW). Do NOT apply the WATCHING template.

       FORBIDDEN on ACTIVE (Layer-1 guard rejects, run will fail and
       retry until you comply):

         ❌ ENTER       — we're already in; nothing to enter

         If you find yourself wanting an ENTER trigger on this
         refresh, the existing position must first be exited
         (close_position) and the thesis downgraded
         (update_thesis(change_status: "WATCHING")) before re-entry
         conditions apply.

       REQUIRED on ACTIVE (Layer-1 guard rejects without ≥1 EXIT):

         ✓ At least one EXIT — the automated stop-loss path. Without
           it the trigger evaluator has no way to fire a tactical
           EXIT when price hits the stop. Use PRICE_BELOW(stop_loss)
           for LONG positions, PRICE_ABOVE(stop_loss) for SHORT.

       CANONICAL SHAPE — use defaultTriggersForHorizon(horizon, prices,
       "HELD") as your reference. It emits:
         • EXIT on stop_loss (LONG: PRICE_BELOW; SHORT: PRICE_ABOVE)
         • For TRADE horizon: EXIT on target_price (auto-take-profit)
         • For TARGET horizon: REVIEW on target_price (re-evaluate
           at target, don't auto-exit)
         • REVIEW on earnings (BEAT and MISS), filings, time-elapsed
           hygiene per horizon
         • Optional TRIM/ADD/MOVE_STOP when the thesis explicitly
           plans scaling or trailing stops

       BEFORE YOU PERSIST — sanity check your triggers array:
         1. ZERO triggers with action ENTER. If any, remove them.
         2. At least one trigger has action EXIT? If not, add one
            (PRICE_BELOW stop for LONG, PRICE_ABOVE stop for SHORT).
         3. The simplest safe path is to pass the verbatim output of
            defaultTriggersForHorizon(horizon, prices, "HELD") — that
            satisfies both guards and matches the canonical shape.`
    : opts.mode === "refresh" && opts.existingThesis?.status === "PROMOTED"
    ? `       *** YOU ARE REFRESHING A PROMOTED THESIS ***
       The existing thesis row is status="PROMOTED" — the user just
       graduated this analyst to live money and the paper position
       was force-closed at promotion. Your job is RESEARCH REFRESH
       ONLY. The status decision (re-enter via place_trade / defer
       to WATCHING / kill) belongs to the next daily run, NOT to you.

       Apply the PROMOTED trigger template via
       defaultTriggersForHorizon(horizon, prices, "PROMOTED") —
       already shipped via PR #333. This emits ENTER + REVIEW (no
       EXIT — no live position to exit).

       FORBIDDEN on PROMOTED refresh (Layer-1 guard rejects when
       runMode === "THESIS_WRITER"):

         ❌ update_thesis(change_status: ...) — the status decision
            is the daily run's call. You write research; the
            orchestrator decides re-enter / defer / kill. Calling
            update_thesis(change_status: "WATCHING") on a PROMOTED
            refresh is the failure shape that caused 3 production
            status flips on 2026-05-26 (AVGO, MRVL, TSM) — don't
            repeat it.

         ❌ place_trade — not in your allowlist (defensive — the
            writer never executes trades).

       REQUIRED on PROMOTED refresh:

         ✓ update_thesis with refreshed content (target / stop /
           triggers / belief / sections). NO change_status arg.
           Leave status as PROMOTED. The next daily run will read
           your refreshed research and decide the live entry.

       BEFORE YOU PERSIST — sanity check your update_thesis args:
         1. NO change_status arg. If present, remove it. The thesis
            stays PROMOTED until the orchestrator acts.
         2. Trigger array follows the PROMOTED template (ENTER +
            REVIEW, no EXIT). Pass the verbatim output of
            defaultTriggersForHorizon(horizon, prices, "PROMOTED").`
    : `       *** YOU ARE WRITING A WATCHING THESIS ***
       ${opts.mode === "mint" ? `This is a MINT — net-new coverage on $${T}, will be persisted as WATCHING.` : `The existing thesis row is status="${opts.existingThesis?.status ?? "WATCHING"}" — apply the WATCHING template.`}

       FORBIDDEN on WATCHING (Layer-1 guard rejects, run will fail and
       retry until you comply):

         ❌ EXIT       — nothing to exit; we have no position
         ❌ TRIM       — nothing to trim
         ❌ ADD        — nothing to scale into
         ❌ MOVE_STOP  — no stop on a position that doesn't exist

         If you find yourself wanting to express "exit if X happens"
         on a WATCHING thesis, you mean ONE of two things:
           (a) "remove this name from the watchlist if X happens" →
               that's update_thesis(change_status: ARCHIVED) at the
               moment X happens, NOT a pre-positioned EXIT trigger.
           (b) "re-evaluate the entry decision if X happens" →
               use action: "REVIEW", not EXIT.

       REQUIRED on WATCHING (Layer-1 guard rejects without ≥1 ENTER):

         ✓ At least one ENTER — the specific condition that would
           cause us to BUY this stock. Tactical wakes on this fire.

       CHOOSING THE ENTER TRIGGER — match the SETUP INTENT, not the
       default target-price level. Read each pattern and pick:

         • Pre-catalyst accumulation (catalyst is dated within ~7
           days; play is "buy NOW to ride into the event"): use an
           event-based ENTER — EARNINGS_BEAT (LONG) or EARNINGS_MISS
           (SHORT) — that fires on the catalyst confirming. The
           default catalyst template now picks this automatically
           when catalystDate is within 7d. DO NOT pass
           PRICE_ABOVE(target_price) as ENTER on a near-term catalyst
           play — that would gate entry at the take-profit level, so
           you'd be entering at the top after the move is done.

         • Post-event confirmation (waiting for the catalyst to print
           before entering, catalyst further out): use EARNINGS_BEAT
           (or matching event) as ENTER. Entry is conditional on the
           print confirming direction.

         • Breakout pattern (waiting for resistance break, then ride
           the continuation): use PRICE_ABOVE(breakout_level), where
           breakout_level is BELOW target_price. The target is the
           take-profit; the breakout is the entry.

         • Pullback pattern (waiting for retrace to support before
           entry): use PRICE_BELOW(pullback_level) as a REVIEW
           trigger and let the next daily-run decide at that level —
           pullback entries need fresh judgment, not an auto-fire.

       REVIEW triggers stay as today: earnings outcomes (REVIEW),
       filings (REVIEW), time-based hygiene (REVIEW), "this would
       warrant a fresh look" predicates.

       BEFORE YOU PERSIST — sanity check your triggers array:
         1. ZERO triggers with action EXIT, TRIM, ADD, or MOVE_STOP.
            If any, remove them now.
         2. At least one trigger has action ENTER? If not, add one.
         3. Re-read the predicate of your ENTER trigger — does it
            match the SETUP INTENT (event-based for near-term
            catalyst, breakout-level-below-target for breakout, etc.)?
            If you defaulted to PRICE_ABOVE(target_price) on a
            near-term catalyst play, fix it before persisting.`
}

4. Persist the thesis. PR-9 flat schema: pass the 9 individual section
   args (NOT a single research_sections blob — that arg was dropped).
   Map write_thesis_research's data.sections keys to the tool args:

     sections.snapshot           → snapshot               (text shape)
     sections.recentCatalysts    → recent_catalysts       (text shape)
     sections.fundamentals       → fundamentals           (text shape)
     sections.latestEarnings     → latest_earnings        (bullet shape)
     sections.catalystsAndEvents → catalysts_and_events   (bullet shape)
     sections.bullCase           → bull_case              (bullet shape)
     sections.bearCase           → bear_case              (bullet shape)
     sections.analystConsensus   → analyst_consensus      (text shape)
     sections.insiderTechnical   → insider_technical      (text shape)

   (Note: there's also a stock_fundamentals arg — that's the legacy
   structured-data object {market_cap, pe_ratio, ...} for the inline
   tool-card render only. Do NOT confuse it with the V2 fundamentals
   narrative section above.)

   ━━━ FORWARD-VERBATIM RULE — DO NOT RESHAPE ━━━━━━━━━━━━━━━━━━━━━━━━━
   Pass each section arg EXACTLY as write_thesis_research returned it in
   its sections object. The tool schemas expect:

     • Text sections    → { text: string, citations?: string[] }
     • Bullet sections  → { bullets: [{ text: string, citation?: string }] }

   Forbidden:
     • Do NOT collapse {text, citations} into a raw string — citations get
       stripped and the renderer falls back to inferior plain-text mode.
     • Do NOT snake_case the keys inside the object (it's \`text\` and
       \`citations\`, not \`text_content\` or \`citation_list\`).
     • Do NOT rebuild bullet shapes from prose — the parser already split
       them. Pass {bullets: [...]} verbatim.
     • Do NOT rename the section keys at the destination (the args are
       snake_case at the tool boundary, but the VALUES are camelCase
       objects exactly as the meta-tool returned).

   Correct usage:
     bull_case: sections.bullCase            // ✓ verbatim object
     snapshot: sections.snapshot             // ✓ verbatim object

   Wrong:
     bull_case: "**Bull Case** ..."          // ✗ raw string — Zod rejects
     bull_case: { bullets: [...prose...] }   // ✗ reshaped — citations gone
     bull_case: { text: "...", citations:[] }// ✗ wrong shape for bullet section

     ${opts.mode === "refresh" && opts.existingThesis ? `- update_thesis(thesis_id="${opts.existingThesis.id}", <all decision fields>, research_data=<rawDataBlock>, snapshot=<sections.snapshot>, bull_case=<sections.bullCase>, ...the other 7 section args, rationale="<one line>")` : `- record_thesis(ticker="${T}", <all decision fields>, research_data=<rawDataBlock>, snapshot=<sections.snapshot>, bull_case=<sections.bullCase>, ...the other 7 section args, source_kind=..., source_rationale=...)`}

   The research_data + the 9 section args MUST be passed verbatim from
   write_thesis_research's return value — that's how the deep research
   lands on the Thesis row for the card.

5. Call complete_run.

QUALITY BAR
- The card the user opens should read like a Goldman initiation note,
  not a one-paragraph rationale.
- The bear case must be substantive even on LONG. No "generic risks
  like market volatility" — specific numbers, specific scenarios.
- Every belief, assumption, and invalidation condition must trace back
  to something in the synthesized research.
- TOOL CALLS only. No prose monologue between calls. Text-only assistant
  turns terminate the run as FAILED.`;
}

export async function runThesisWriterAgent(
  args: RunThesisWriterArgs,
): Promise<RunThesisWriterResult> {
  const t0 = Date.now();
  const T = args.ticker.toUpperCase();

  // ── 1. Load context ─────────────────────────────────────────────────
  const analyst = await prisma.agentConfig.findUnique({
    where: { id: args.analystId },
    select: {
      id: true,
      userId: true,
      accountId: true,
      name: true,
      analystPrompt: true,
      sectors: true,
      industries: true,
      themes: true,
      exclusionList: true,
      minConfidence: true,
      maxPositionSize: true,
      realMaxPosition: true,
      maxOpenPositions: true,
      tradingEnvironment: true,
    },
  });

  if (!analyst) {
    await prisma.researchRun.updateMany({
      where: { id: args.childRunId, status: "RUNNING" },
      data: { status: "FAILED", completedAt: new Date() },
    });
    return {
      childRunId: args.childRunId,
      status: "FAILED",
      thesisId: null,
      steps: 0,
      toolCalls: 0,
      elapsedMs: Date.now() - t0,
      error: `Analyst ${args.analystId} not found`,
    };
  }

  // ── Outer try/catch — DEFENSE IN DEPTH ──────────────────────────────
  // Wraps the entire setup + agent loop so ANY throw (Prisma read, alpaca
  // creds resolve, watchlist fetch, tool factory, prompt build, model
  // call, message persistence) lands in the catch and marks the run
  // FAILED. Without this, the pre-2026-05-19 narrow try around
  // generateText left a hole: anything that threw before the agent loop
  // (e.g. Anthropic returning a structured rate-limit ERROR on the first
  // attempt — which bubbled through resolveAlpacaCredentials retries?
  // No, more commonly the Inngest step retry semantics + the narrow try
  // combination) left the ResearchRun stuck in RUNNING forever. The
  // /runs page's 10-minute stale-detect only fires when someone opens
  // the detail page, so stuck rows piled up on the index. See PR (this
  // one) — observed 2 RUNNING-forever LSCC runs (rate-limit casualties)
  // on 2026-05-19.
  try {
  let existingThesis: NonNullable<
    Parameters<typeof buildThesisWriterSystemPrompt>[0]["existingThesis"]
  > | null = null;
  if (args.mode === "refresh" && args.existingThesisId) {
    const row = await prisma.thesis.findUnique({
      where: { id: args.existingThesisId },
      select: {
        id: true,
        status: true,
        direction: true,
        horizon: true,
        coreBelief: true,
        targetPrice: true,
        stopLoss: true,
        scoring: true,
        snapshot: true,
      },
    });
    if (row) {
      // PR-9: legacy 0-100 confidence → composite × 10 for prompt context
      // (the agent's existing thesis preview still talks about 0-100).
      const composite = getThesisComposite(row);
      existingThesis = {
        id: row.id,
        status: row.status,
        direction: row.direction,
        horizon: row.horizon,
        coreBelief: row.coreBelief,
        targetPrice: row.targetPrice != null ? Number(row.targetPrice) : null,
        stopLoss: row.stopLoss != null ? Number(row.stopLoss) : null,
        confidenceScore: composite != null ? composite * 10 : 0,
        reasoningSummary: getThesisSnapshotText(row),
      };
    }
  }

  // ── 2. Build tools (filtered by allowlist) ──────────────────────────
  const runEnvironment =
    (analyst.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
  const alpacaCreds =
    (await resolveAlpacaCredentials(analyst.userId, runEnvironment)) ??
    undefined;
  const watchlistSymbols = await getWatchlistSymbols(analyst.id);

  const allTools = createResearchTools({
    runId: args.childRunId,
    userId: analyst.userId,
    accountId: analyst.accountId,
    analystId: analyst.id,
    // runMode passthrough so update_thesis can refuse status flips on
    // PROMOTED refreshes from this code path (GAPS P0-4 Layer-1 backstop).
    runMode: "THESIS_WRITER",
    watchlist: watchlistSymbols,
    exclusionList: analyst.exclusionList ?? [],
    sectors: analyst.sectors ?? [],
    industries: analyst.industries ?? [],
    themes: analyst.themes ?? [],
    maxPositionSize: Number(analyst.maxPositionSize),
    realMaxPosition: Number(analyst.realMaxPosition),
    maxOpenPositions: analyst.maxOpenPositions,
    minConfidence: analyst.minConfidence,
    alpacaCreds,
    runEnvironment,
    // Chat-dispatched mints clamp to WATCHING (see dispatch-thesis-research
    // comment + record_thesis enforcement). Daily-run refresh dispatches
    // (Phase 3) and tactical inline calls (Phase 4) pass false / unset.
    forceWatchingMint: args.forceWatchingMint === true,
  });

  const modeConfig = MODES["thesis-writer"];
  const allowlist = modeConfig.toolAllowlist;
  const tools = allowlist
    ? Object.fromEntries(
        allowlist
          .map(
            (name) =>
              [name, allTools[name as keyof typeof allTools]] as const,
          )
          .filter(([, v]) => v != null),
      )
    : allTools;

  // ── 3. System + user prompts ────────────────────────────────────────
  // ISO YYYY-MM-DD in UTC — passed into the writer prompt's date-awareness
  // block so the agent can identify future-dated catalysts and discard
  // hallucinated past-tense actuals from web_search. UTC over local time
  // because catalysts (earnings, SEC filings) are conventionally indexed
  // in UTC and the writer needs a stable reference; off-by-a-day at the
  // tz boundary is harmless because the gate operates on later-than-today
  // semantics, not exact-match.
  const runDate = new Date().toISOString().slice(0, 10);
  const systemPrompt = buildThesisWriterSystemPrompt({
    analystName: analyst.name,
    analystPrompt: analyst.analystPrompt,
    ticker: T,
    mode: args.mode,
    existingThesis,
    reason: args.reason,
    minConfidence: analyst.minConfidence,
    runDate,
    promotionContext: args.promotionContext ?? null,
  });

  const userPrompt =
    `Write a deep-research thesis on $${T} (${args.mode}). ` +
    `Follow the 5-step workflow above. TOOL CALLS only — no narration. ` +
    `Begin with write_thesis_research now.`;

  // ── 4. Run the agent ───────────────────────────────────────────────
  // Provider chosen by mode config; anthropic is the bake-off winner
  // (2026-05-16, see MODES["thesis-writer"] comment). openai branch kept
  // as a fallback path if the mode config is ever swapped to a non-
  // Anthropic model — but per the bake-off, avoid GPT-5/o3 family.
  const model =
    modeConfig.provider === "anthropic"
      ? anthropic(modeConfig.model as Parameters<typeof anthropic>[0])
      : openai(modeConfig.model);

  // ── Outer-agent web_search: use the Perplexity Sonar user-tool ──────────
  // The synthesis call INSIDE write_thesis_research uses Anthropic's native
  // webSearch_20260209 — that's where the bake-off's depth advantage lives.
  // The OUTER agent's web_search is just an escape hatch ("if the meta-tool
  // returned a thin synthesis, verify one number"); the depth doesn't matter
  // here, only availability.
  //
  // Pre-2026-05-20 we overrode the `web_search` key with the native
  // Anthropic tool at this level too. That caused two real problems on
  // the $MDB refresh test (cmpean45q...):
  //
  //   1. Anthropic's webSearch invokes server-side companion tools
  //      (`code_execution_20250825` etc.) under the hood. The AI SDK
  //      surface didn't know about those companions, so Claude's tool
  //      calls came back referencing IDs the SDK couldn't resolve:
  //      "Tool call srvtoolu_01STVZ5cWyYF7o6HDhSd9Zsx not found." The
  //      thesis had already been persisted; the run got marked FAILED
  //      anyway on that uncaught error.
  //   2. Time. The 2 outer web_search calls + 3 companion code_execution
  //      calls ate 700+ seconds of the agent's budget (write_thesis_research
  //      itself only took 186s). Cutting the override moves that budget
  //      back to the rest of the workflow.
  //
  // Keep the Perplexity Sonar tool (the user-tool already in the
  // toolAllowlist) as the outer-agent's web_search. The native tool stays
  // inside write_thesis_research's synthesis call — same place it always
  // earned its keep.
  const toolsWithSearch = tools;

  const toolStats: Record<
    string,
    { count: number; totalLatencyMs: number; errors: number }
  > = {};
  let lastStepTimeMs = t0;

  try {
    const { steps, response } = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: toolsWithSearch as any,
      // Anthropic providerOptions: extended thinking off here — the prompt
      // is short and the work is mostly tool dispatch. OpenAI gets
      // strictJsonSchema for arg validation. No-op for either when the
      // other provider's options aren't applicable.
      ...(modeConfig.provider === "openai"
        ? { providerOptions: { openai: { strictJsonSchema: true } } }
        : {}),
      stopWhen: stepCountIs(modeConfig.maxSteps),
      // 30s of headroom inside the function's maxDuration so the catch
      // block can mark the run terminal before Vercel kills the process.
      abortSignal: AbortSignal.timeout((modeConfig.maxDuration - 30) * 1000),
      onStepFinish({ stepNumber, toolCalls, finishReason, text: stepText }) {
        const now = Date.now();
        const stepLatencyMs = now - lastStepTimeMs;
        lastStepTimeMs = now;
        const toolNames = toolCalls.map((tc) => tc.toolName).join(", ") || "none";
        const textPreview = stepText?.slice(0, 80)?.replace(/\n/g, " ") || "";
        console.log(
          `[thesis-writer] STEP #${stepNumber} child=${args.childRunId} ticker=${T} tools=[${toolNames}] finish=${finishReason} text="${textPreview}"`,
        );
        for (const call of toolCalls) {
          const bucket = toolStats[call.toolName] ?? {
            count: 0,
            totalLatencyMs: 0,
            errors: 0,
          };
          bucket.count += 1;
          bucket.totalLatencyMs += stepLatencyMs;
          toolStats[call.toolName] = bucket;
        }
      },
    });

    const totalToolCalls = steps.reduce(
      (sum, s) => sum + (s.toolCalls?.length ?? 0),
      0,
    );
    const elapsed = Date.now() - t0;

    // ── 5. Persist conversation messages ─────────────────────────────
    let responseMessages = response?.messages;
    if (
      !responseMessages ||
      !Array.isArray(responseMessages) ||
      responseMessages.length === 0
    ) {
      responseMessages = steps.flatMap((s) => {
        const stepMsgs = (
          s as unknown as { response?: { messages?: unknown[] } }
        ).response?.messages;
        return Array.isArray(stepMsgs) ? stepMsgs : [];
      }) as typeof responseMessages;
    }
    try {
      const userMessage = {
        role: "user",
        content: [{ type: "text", text: userPrompt }],
      };
      const allMessages = [userMessage, ...(responseMessages ?? [])];
      await prisma.$transaction(async (tx) => {
        await tx.runMessage.deleteMany({ where: { runId: args.childRunId } });
        await tx.runMessage.create({
          data: {
            runId: args.childRunId,
            role: "thread",
            content: JSON.stringify(allMessages),
          },
        });
      });
    } catch (msgErr) {
      console.error(
        `[thesis-writer] failed to persist messages for run=${args.childRunId}:`,
        msgErr instanceof Error ? msgErr.message : msgErr,
      );
    }

    // ── 6. Determine outcome ─────────────────────────────────────────
    // Success = a Thesis row got written/touched on this run. For mint
    // mode, look at thesis insert; for refresh, look at a ThesisUpdate
    // touching the existing thesis. If neither happened the run failed
    // its contract.
    let thesisId: string | null = null;
    if (args.mode === "mint") {
      const mintedThesis = await prisma.thesis.findFirst({
        where: { researchRunId: args.childRunId, ticker: T },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      thesisId = mintedThesis?.id ?? null;
    } else if (args.existingThesisId) {
      const refreshTouch = await prisma.thesisUpdate.findFirst({
        where: { runId: args.childRunId, thesisId: args.existingThesisId },
        select: { thesisId: true },
      });
      thesisId = refreshTouch?.thesisId ?? null;
    }

    const finalStatus: "COMPLETE" | "FAILED" =
      thesisId !== null ? "COMPLETE" : "FAILED";

    // Atomic — only transition RUNNING → terminal. complete_run may have
    // already marked COMPLETE; that wins.
    await prisma.researchRun.updateMany({
      where: { id: args.childRunId, status: "RUNNING" },
      data: { status: finalStatus, completedAt: new Date() },
    });

    // Enrich parameters with toolStats (non-critical, separate write).
    try {
      const fresh = await prisma.researchRun.findUnique({
        where: { id: args.childRunId },
        select: { parameters: true },
      });
      await prisma.researchRun.update({
        where: { id: args.childRunId },
        data: {
          parameters: {
            ...((fresh?.parameters as object) ?? {}),
            agentSteps: steps.length,
            agentToolCalls: totalToolCalls,
            elapsedMs: elapsed,
            toolStats: {
              totalToolCalls: Object.values(toolStats).reduce(
                (s, b) => s + b.count,
                0,
              ),
              durationMs: elapsed,
              byTool: toolStats,
            },
            thesisId,
          } as object,
        },
      });
    } catch (statsErr) {
      console.warn(
        `[thesis-writer] failed to persist toolStats for run=${args.childRunId}:`,
        statsErr instanceof Error ? statsErr.message : statsErr,
      );
    }

    if (finalStatus === "FAILED") {
      try {
        await prisma.runEvent.create({
          data: {
            runId: args.childRunId,
            type: "run_failed",
            title: "Thesis-writer did not produce a thesis",
            message: `Ran ${steps.length} steps / ${totalToolCalls} tool calls without ${args.mode === "mint" ? "record_thesis" : "update_thesis"}.`,
            payload: {
              ticker: T,
              mode: args.mode,
              steps: steps.length,
              toolCalls: totalToolCalls,
            } as object,
          },
        });
      } catch {
        /* event write is best-effort */
      }
    }

    return {
      childRunId: args.childRunId,
      status: finalStatus,
      thesisId,
      steps: steps.length,
      toolCalls: totalToolCalls,
      elapsedMs: elapsed,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.message.includes("aborted") ||
        err.message.includes("timed out"));
    const msg = isTimeout
      ? `Thesis-writer timed out after ${Math.round((Date.now() - t0) / 1000)}s.`
      : err instanceof Error
        ? err.message
        : String(err);
    console.error(`[thesis-writer] FAILED ticker=${T} child=${args.childRunId}: ${msg}`);

    try {
      const fresh = await prisma.researchRun.findUnique({
        where: { id: args.childRunId },
        select: { parameters: true },
      });
      await prisma.researchRun.updateMany({
        where: { id: args.childRunId, status: "RUNNING" },
        data: { status: "FAILED", completedAt: new Date() },
      });
      await prisma.researchRun.update({
        where: { id: args.childRunId },
        data: {
          parameters: {
            ...((fresh?.parameters as object) ?? {}),
            error: msg,
            failedAt: new Date().toISOString(),
          } as object,
        },
      });
    } catch {
      /* best-effort */
    }
    return {
      childRunId: args.childRunId,
      status: "FAILED",
      thesisId: null,
      steps: 0,
      toolCalls: 0,
      elapsedMs: Date.now() - t0,
      error: msg,
    };
  }
  } catch (outerErr) {
    // Outer catch — anything that threw during setup before the inner
    // try (Prisma reads, alpaca creds, watchlist fetch, tool factory,
    // prompt build) lands here. Mark the run FAILED so the row never
    // stays in RUNNING.
    const msg =
      outerErr instanceof Error ? outerErr.message : String(outerErr);
    console.error(
      `[thesis-writer] OUTER CATCH ticker=${T} child=${args.childRunId}: ${msg}`,
    );
    try {
      const fresh = await prisma.researchRun.findUnique({
        where: { id: args.childRunId },
        select: { parameters: true },
      });
      await prisma.researchRun.updateMany({
        where: { id: args.childRunId, status: "RUNNING" },
        data: { status: "FAILED", completedAt: new Date() },
      });
      await prisma.researchRun.update({
        where: { id: args.childRunId },
        data: {
          parameters: {
            ...((fresh?.parameters as object) ?? {}),
            error: `Setup error before agent loop: ${msg}`,
            failedAt: new Date().toISOString(),
            outerCatch: true,
          } as object,
        },
      });
    } catch {
      /* best-effort */
    }
    return {
      childRunId: args.childRunId,
      status: "FAILED",
      thesisId: null,
      steps: 0,
      toolCalls: 0,
      elapsedMs: Date.now() - t0,
      error: msg,
    };
  }
}
