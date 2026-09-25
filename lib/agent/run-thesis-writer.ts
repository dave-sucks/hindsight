/**
 * run-thesis-writer.ts — the V2 thesis-writer pipeline: ONE research agent,
 * zero relay. (THESIS_WRITER_V2 — see docs/plans/THESIS_WRITER_V2.md and
 * the diagnosis in docs/plans/AGENT_PERF_COST_FIX.md.)
 *
 * V1 was a two-model relay: a synthesis model inside the
 * write_thesis_research meta-tool wrote a ~25k-char research note, then an
 * OUTER agent re-typed that entire note verbatim into record_thesis /
 * update_thesis args (~160-190s of pure regeneration per persist, ~60%
 * first-attempt Zod bounce, 523s average wall time). V2 deletes the relay:
 *
 *   Phase P — pull    deterministic parallel data pulls (~10s)
 *                     lib/agent/thesis-research/pull-data.ts
 *   Phase R — research ONE generateText call: the model writes the
 *                     9-section note as plain TEXT and finishes by calling
 *                     the compact `submit_thesis` tool (decision fields
 *                     only, ~1-2k chars). Validation errors come back as
 *                     the tool result, so repairs cost one step, not a
 *                     3-minute payload regeneration.
 *   Phase Z — persist server-side: parse the note into sections
 *                     (parse-sections.ts), build the record_thesis /
 *                     update_thesis args programmatically, and call the
 *                     EXISTING tools' execute() — every Layer-1 gate runs
 *                     unchanged. Terminal status is derived from whether a
 *                     thesis row actually landed (no complete_run in this
 *                     mode — a run that wrote nothing can never report
 *                     COMPLETE). The RunMessage thread and phase RunEvents
 *                     persist on EVERY outcome, including timeouts.
 *
 * Phases are exported individually so the Inngest function
 * (lib/inngest/functions/thesis-writer.ts) can run each inside its own
 * step.run — the V1 single 333-760s step made Inngest abandon the HTTP
 * request and silently re-run the whole agent (see the idempotency guard
 * note below). Phases NEVER throw — every failure is contained into the
 * phase output so the persist phase always runs and the run always leaves
 * a debuggable trace.
 *
 * The child ResearchRun row is created upstream by dispatch_thesis_research
 * (or promote-analyst / backfill) before this runs — we receive its id and
 * own its lifecycle.
 */

import { loadScorecardLines } from "@/lib/performance/load-setup-scorecard";
import { setupsForAnalyst, type Setup } from "@/lib/agent/knowledge/setups";
import { loadSetupOverrides } from "@/lib/agent/knowledge/load-setup-overrides";
import { generateText, stepCountIs, tool } from "ai";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { prisma } from "@/lib/prisma";
import { MODES } from "@/lib/agent/modes";
import type { ToolContext } from "@/lib/agent/tool-context";
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import {
  pullThesisData,
  type ThesisPullResult,
} from "@/lib/agent/thesis-research/pull-data";
import {
  parseIntoSections,
  type ParsedSections,
} from "@/lib/agent/thesis-research/parse-sections";
import {
  thesisDecisionSchema,
  validateThesisDecision,
  type ValidatedThesisDecision,
} from "@/lib/agent/thesis-research/decision";
import { recordThesis } from "@/lib/agent/tools/record-thesis";
import { resolveEventDate } from "@/lib/agent/thesis-research/catalyst-on-file";
import { updateThesis } from "@/lib/agent/tools/update-thesis";
import { parseTriggersResilient } from "@/lib/agent/triggers/schema";
import { describeTrigger } from "@/lib/agent/triggers/ops";
import type { Trigger } from "@/lib/agent/triggers/types";

// ── Phase budgets ───────────────────────────────────────────────────────
// V1's inner synthesis abort was 180s against an observed 187-192s EVERY
// run — the safety net was the routine operating point, and losing the
// race produced empty-section runs (CEG 2026-08-11). The research call is
// the long pole; give it real headroom. Worst-case pipeline:
// pulls ~15s + research ≤330s + section-repair ≤90s + persist ~5s ≈ 440s,
// well inside the Inngest route's window with margin — and typically
// ~200-220s total.
const RESEARCH_TIMEOUT_MS = 330_000;
const SECTION_REPAIR_TIMEOUT_MS = 90_000;
/** Native web-search budget for the research call (V1 synthesis used 3). */
const WEB_SEARCH_MAX_USES = 4;
/**
 * Minimum parsed sections before we spend one repair turn asking for the
 * missing ones. 9 is the full template; below 5 the note is materially
 * incomplete (V1's QUALITY BAR equivalent).
 */
const MIN_SECTIONS_BEFORE_REPAIR = 5;

export interface RunThesisWriterArgs {
  childRunId: string;
  analystId: string;
  ticker: string;
  mode: "mint" | "refresh";
  existingThesisId?: string | null;
  reason: string;
  parentRunId?: string | null;
  /**
   * Layer-1 clamp passthrough: forwarded into the persist ctx so
   * record_thesis downgrades any LONG/SHORT/ACTIVE mint to WATCHING.
   * Set by chat-dispatched mints; defaults to false otherwise.
   */
  forceWatchingMint?: boolean;
  /**
   * PAPER→LIVE promotion context. Pre-populated by dispatch_thesis_research
   * for refreshes on PROMOTED theses. When set, the research prompt frames
   * the decision around RE-ENTER / DOWNGRADE / INVALIDATE — but the writer
   * itself still never touches status; the next orchestrator run resolves.
   */
  promotionContext?: {
    paperTenureDays: number | null;
    paperRealizedPnl: number | null;
    paperReviewCount: number | null;
    promotedAt: string | null;
  } | null;
  /**
   * Review clock the dispatcher asked for, in days (DAV-225). Null/absent =
   * no clock. Applied as an ordinary REVIEW_CADENCE rung — researching a
   * name and agreeing to look at it weekly are separate decisions, and the
   * second belongs to whoever asked for the research.
   */
  reviewCadenceDays?: number | null;
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

// ── Shared context loading ─────────────────────────────────────────────

interface WriterAnalyst {
  id: string;
  userId: string;
  accountId: string;
  name: string;
  setupIds: string[];
  analystPrompt: string | null;
  sectors: string[];
  industries: string[];
  themes: string[];
  exclusionList: string[];
  minConfidence: number;
  tradingEnvironment: string | null;
  minPositionSize: unknown;
  maxPositionSize: unknown;
  maxPositionTotal: unknown;
}

async function loadWriterAnalyst(analystId: string): Promise<WriterAnalyst | null> {
  const analyst = await prisma.agentConfig.findUnique({
    where: { id: analystId },
    select: {
      id: true,
      userId: true,
      accountId: true,
      name: true,
      setupIds: true,
      analystPrompt: true,
      sectors: true,
      industries: true,
      themes: true,
      exclusionList: true,
      minConfidence: true,
      tradingEnvironment: true,
      minPositionSize: true,
      maxPositionSize: true,
      maxPositionTotal: true,
    },
  });
  return analyst as WriterAnalyst | null;
}

interface WriterExistingThesis {
  id: string;
  status: string;
  direction: string | null;
  horizon: string | null;
  coreBelief: string | null;
  targetPrice: number | null;
  stopLoss: number | null;
  composite: number | null;
  snapshotText: string;
  /** The stored triggers, with ids — a refresh edits them one at a time. */
  triggers: Trigger[];
}

async function loadExistingThesis(
  existingThesisId: string,
): Promise<WriterExistingThesis | null> {
  const row = await prisma.thesis.findUnique({
    where: { id: existingThesisId },
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
      triggers: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    direction: row.direction,
    horizon: row.horizon,
    coreBelief: row.coreBelief,
    targetPrice: row.targetPrice != null ? Number(row.targetPrice) : null,
    stopLoss: row.stopLoss != null ? Number(row.stopLoss) : null,
    composite: getThesisComposite(row),
    snapshotText: getThesisSnapshotText(row),
    triggers: parseTriggersResilient(row.triggers).triggers as Trigger[],
  };
}

/**
 * ToolContext for the pull + persist phases. Mirrors what V1's
 * createResearchTools call threaded through, minus the trading fields the
 * writer never uses (no alpaca creds — the writer cannot trade).
 * `calledTickers` is pre-seeded with the target ticker because the pull
 * phase DID call get_stock_data for it — record_thesis's
 * researched-before-thesis gate keys on exactly that.
 */
async function buildWriterToolCtx(
  args: RunThesisWriterArgs,
  analyst: WriterAnalyst,
): Promise<ToolContext> {
  const T = args.ticker.toUpperCase();
  // Watchlist parity with V1: get_stock_data's universe fence short-circuits
  // for watchlist names (the Thesis store IS the watchlist), so a refresh on
  // a name outside the sector fence must still be able to pull data.
  let watchlist: string[] = [];
  try {
    watchlist = await getWatchlistSymbols(analyst.id);
  } catch {
    /* fence just falls back to universe-only matching */
  }
  const runEnvironment = (analyst.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
  // Alpaca creds so record_thesis's recently-sold gate can read the
  // account; the sizing fields feed place_trade's band (not used by the
  // writer itself).
  let alpacaCreds;
  try {
    alpacaCreds = (await resolveAlpacaCredentials(analyst.userId, runEnvironment)) ?? undefined;
  } catch {
    /* fail-open — the gate itself fails open without creds */
  }
  const ctx = {
    runId: args.childRunId,
    userId: analyst.userId,
    accountId: analyst.accountId,
    analystId: analyst.id,
    runMode: "THESIS_WRITER",
    runEnvironment,
    watchlist,
    exclusionList: analyst.exclusionList ?? [],
    sectors: analyst.sectors ?? [],
    industries: analyst.industries ?? [],
    themes: analyst.themes ?? [],
    minConfidence: analyst.minConfidence,
    minPositionSize: Number(analyst.minPositionSize),
    maxPositionSize: Number(analyst.maxPositionSize),
    maxPositionTotal: Number(analyst.maxPositionTotal),
    alpacaCreds,
    forceWatchingMint: args.forceWatchingMint === true,
    groupId: (phase: string) => phase,
    calledTickers: new Map([[T, new Set(["get_stock_data"])]]),
    signalsByTicker: new Map<string, Set<string>>(),
  };
  return ctx as unknown as ToolContext;
}

// ── Research prompt ─────────────────────────────────────────────────────

export interface WriterResearchPromptOpts {
  analystName: string;
  analystPrompt: string | null;
  ticker: string;
  mode: "mint" | "refresh";
  existingThesis: WriterExistingThesis | null;
  reason: string;
  minConfidence: number;
  /** ISO YYYY-MM-DD (UTC) — date-awareness block. */
  runDate: string;
  promotionContext?: RunThesisWriterArgs["promotionContext"];
  /**
   * This analyst's own closed-trade record by setup (DAV-248), one data line
   * each — "Base breakout: 12 trades, 42% win, +1.9R, 11d held, …". Empty or
   * absent → no block.
   */
  setupRecord?: string[];
  /** The setups this analyst writes on (setupsForAnalyst) — the prompt lists them. */
  setups?: Setup[];
  /** P1-35: this analyst sold this ticker within the last 14 days. */
  priorExit?: {
    exitPrice: number | null;
    daysAgo: number;
    closeReason: string | null;
  } | null;
}

/**
 * System prompt for the single research call. The model writes the full
 * 9-section note as plain text, then calls submit_thesis ONCE with the
 * compact decision object. Section headers here MUST stay in sync with
 * SECTION_HEADERS in parse-sections.ts — the server parses this exact
 * template.
 */
export function buildWriterResearchPrompt(opts: WriterResearchPromptOpts): string {
  const T = opts.ticker.toUpperCase();

  const existingBlock =
    opts.mode === "refresh" && opts.existingThesis
      ? `EXISTING THESIS (you are REFRESHING it, not starting fresh):
  • status: ${opts.existingThesis.status}
  • direction: ${opts.existingThesis.direction ?? "—"}
  • horizon: ${opts.existingThesis.horizon ?? "—"}
  • core belief: ${opts.existingThesis.coreBelief ?? "—"}
  • target_price: ${opts.existingThesis.targetPrice ?? "—"}
  • stop_loss: ${opts.existingThesis.stopLoss ?? "—"}
  • composite: ${opts.existingThesis.composite ?? "—"}/10
  • snapshot: ${opts.existingThesis.snapshotText.slice(0, 300)}
  • triggers (edit by id — these ids are the handles):
${
  opts.existingThesis.triggers.length
    ? opts.existingThesis.triggers
        .map(
          (t) =>
            `      - ${t.id}: ${describeTrigger(t, opts.existingThesis!.direction)} — "${t.rationale.slice(0, 90)}"`,
        )
        .join("\n")
    : "      (none)"
}

Where new evidence contradicts or supersedes the existing view, flag the
change explicitly in the note.`
      : `MODE: MINT — net-new coverage on $${T}. The thesis will be persisted
as WATCHING (entry-gated). Entering a position is a separate, later
decision by the orchestrator — you are writing the research and the plan.`;

  // Trigger-template rules branch on position state. Held (HOLDING) theses
  // protect an open position; everything else (mint / WATCHING / PROMOTED)
  // has no position and describes entry conditions.
  const isHeldRefresh =
    opts.mode === "refresh" && opts.existingThesis?.status === "HOLDING";
  const isPromotedRefresh =
    opts.mode === "refresh" && opts.existingThesis?.status === "PROMOTED";

  const triggerBlock = isHeldRefresh
    ? `TRIGGERS — YOU ARE REFRESHING A HELD THESIS (open position):
  • Legal actions: EXIT, REVIEW, TRIM, ADD, MOVE_STOP. NEVER ENTER —
    we already own it.
  • At least one EXIT rung on the stop (PRICE_BELOW stop for LONG,
    PRICE_ABOVE stop for SHORT) — that's the automated stop-loss path.
  • Triggers are edited ONE AT A TIME: edit_triggers by the ids listed
    under EXISTING THESIS (a level change needs a rationale),
    add_triggers for a new one, remove_trigger_ids to retire one.
    Everything you don't name stays exactly as it is. Most refreshes
    need no trigger ops at all.
  • PROTECTIVE LEVELS ONLY TIGHTEN on a stock we own. The stop on record
    is $${opts.existingThesis?.stopLoss ?? "—"}: submit that number or a
    tighter one. A looser stop is refused by itself — the rest of the
    refresh still lands. If you believe the stop is wrong, keep it and
    say so in the rationale with the number you'd suggest — that reaches
    the principal; you cannot move it.`
    : isPromotedRefresh
      ? `TRIGGERS — YOU ARE REFRESHING A PROMOTED THESIS (no live position):
  • The paper position was force-closed at promotion. Legal actions:
    ENTER + REVIEW only. NEVER EXIT/TRIM/ADD/MOVE_STOP — there is no
    position to manage.
  • You do NOT decide re-entry. Status stays PROMOTED; the next daily
    run reads your refreshed research and decides RE-ENTER (place_trade)
    / DEFER (downgrade to WATCHING) / KILL. Frame the note so that
    decision is easy, and put your recommended call in the rationale.`
      : `TRIGGERS — WATCHING thesis (no position; we're waiting for a reason to buy):
  • Legal actions: ENTER + REVIEW only. NEVER EXIT/TRIM/ADD/MOVE_STOP —
    there is no position.
  • The ENTER rung follows the level: PRICE_ABOVE(entry_price) for a
    breakout above the tape, PRICE_BELOW(entry_price) for a pullback
    below it (mirror for SHORT). A setup already true today is an entry
    at or a few cents past the live price.
  • A chart condition from the setup's entry rule that isn't a price
    (NEAR_SMA for a pullback, EARNINGS_SINCE for PEAD day 1–3, GAP_UP)
    can be added as its own ENTER trigger next to the price level —
    whichever comes true first wakes the buy decision.
  • Most theses need NO custom triggers — omit the field and the
    horizon-default template (entry/stop/review) is applied for you.
  • Setting an existing priced plan DOWN on a refresh (levels no longer
    worth holding): omit entry/target/stop AND send remove_trigger_ids
    naming the buy, floor and target trigger ids from EXISTING THESIS,
    keeping ≥1 REVIEW wake — the level columns follow the triggers.`;

  // Earnings triggers fire off the published calendar (no news needed).
  // The account already carries the basics for every name; the writer
  // authors one only where the report IS the thesis.
  const earningsTriggerBlock = `
EARNINGS TRIGGERS — three kinds, all live (they read the earnings
calendar, not news):
  • EARNINGS_WITHIN { days } — "reports within N days", the heads-up
    BEFORE the report. Fires once per approaching report.
  • EARNINGS_BEAT / EARNINGS_MISS { minSurprisePct? } — reported EPS
    against the estimate, at the first open after the report.
  The account rules already give EVERY name a 3-day heads-up and a
  review on any beat or miss, so most theses need none of these. Author
  one only when the report is the thesis: a CATALYST built on the print
  wants a tighter bar (EARNINGS_BEAT minSurprisePct 5 → REVIEW, or the
  miss → EXIT on a held name); a long-dated COMPOUNDER may want a wider
  heads-up (EARNINGS_WITHIN 7). Never ENTER on a beat by itself — a beat
  the stock sold on is the market saying it wanted more; price the entry.`;

  const priorExitBlock = opts.priorExit
    ? `
⚠ RECENTLY SOLD — YOU exited this name ${opts.priorExit.daysAgo} day${opts.priorExit.daysAgo === 1 ? "" : "s"} ago${opts.priorExit.exitPrice != null ? ` at $${opts.priorExit.exitPrice}` : ""}${opts.priorExit.closeReason ? ` (${opts.priorExit.closeReason})` : ""}.
If your entry_price is AT OR ABOVE that exit price, submit_thesis REQUIRES \`prior_exit_acknowledgment\`: one line that genuinely engages with the sale — why this is a NEW setup and not a re-buy of the dip you just sold (e.g. "stopped out at $66.53; re-entering only on a confirmed reclaim of the 20-day — different structure"). Below the exit price no acknowledgment is needed, but underwrite with the sale in view, not from amnesia.
`
    : "";

  const promotionBlock = opts.promotionContext
    ? `
PROMOTION CONTEXT — this refresh is part of a PAPER→LIVE promotion.
Paper history on $${T}: held ${opts.promotionContext.paperTenureDays ?? "?"} days,
realized P&L ${opts.promotionContext.paperRealizedPnl != null ? `$${opts.promotionContext.paperRealizedPnl.toFixed(2)}` : "unknown"},
reviewed ${opts.promotionContext.paperReviewCount ?? "?"} times, promoted ${opts.promotionContext.promotedAt ?? "today"}.
Frame the decision explicitly around the three legal first-live-run
outcomes: RE-ENTER (conviction intact at current prices) / DEFER
(conviction softened — wait for a cleaner entry) / KILL (a key assumption
broke). State which one you'd make, and why, in the submit_thesis
rationale — the next daily run executes it, not you.
`
    : "";

  const setups = opts.setups ?? [];
  const setupsBlock = setups.length
    ? `
═══════════════════════════════════════════════════════════════════
YOUR SETUPS — every LONG/SHORT plan is written on one of these
═══════════════════════════════════════════════════════════════════
${setups
  .map(
    (s) => `${s.id} — ${s.name}
  ${s.summary}
  Needs: ${s.preconditions.join("; ")}
  Entry: ${s.entry.text}
  Stop: ${s.stop.text}
  Target: ${s.target.text}
  Time: ${s.time.text}`,
  )
  .join("\n\n")}
`
    : "";

  return `You are ${opts.analystName}, writing one deep-research thesis on $${T}.

${opts.analystPrompt ? `Your strategy:\n${opts.analystPrompt}\n` : ""}${setupsBlock}
WHY YOU WERE DISPATCHED
${opts.reason}

${existingBlock}
${promotionBlock}
═══════════════════════════════════════════════════════════════════
DATE-AWARENESS — read before any earnings or catalyst claim
═══════════════════════════════════════════════════════════════════
Today is ${opts.runDate}. Any catalyst dated later than today has NOT yet
occurred. Frame future catalysts as "expected" / "consensus expects" —
NEVER "reported" / "beat" / "missed". If a web search result claims a
future-dated catalyst already printed (past-tense verbs + specific
actuals), it is a hallucination — discard the ENTIRE claim, do not
"fix" the number (production incident 2026-05-26, PR #354). Cross-check
every earnings claim against the Earnings History rows in the
ground-truth data: if the quarter isn't there, it hasn't reported.

═══════════════════════════════════════════════════════════════════
YOUR JOB — one research note, then one submit_thesis call
═══════════════════════════════════════════════════════════════════

STEP 1 — write the research note as plain markdown text, using EXACTLY
these section headers (the server parses them — renamed or skipped
headers are dropped research):

   ## Snapshot
   One paragraph framing where the stock is today.

   ## Recent Catalysts
   One paragraph on what's moved the stock in the last 1-2 weeks and why.

   ## Fundamentals
   One paragraph + segment breakdown if available — revenue trajectory,
   margins, FCF, EPS with multi-year context.

   ## Latest Earnings
   5 bullets — top takeaways from the most recent call, each with a
   specific number, quote, or commitment.

   ## Catalysts & Events
   3-5 dated bullets — specific events in the next 1-3 months.

   ## Bull Case
   3-5 cited bullets — each tied to a data point or recent event.

   ## Bear Case
   3-5 cited bullets — MANDATORY even on LONG. Specific risks with data;
   "market volatility" and "competition" are forbidden.

   ## Analyst Consensus
   One paragraph naming specific firms/analysts and their actions.

   ## Insider & Technical
   One paragraph — open-market insider buying (the Insider Activity
   block) + the chart from the Price structure block: which of YOUR
   SETUPS it is, and the numbers it gives (pivot, moving average,
   swing low, ATR).

   Ground rules for the note:
   • The GROUND-TRUTH DATA block in the user message is authoritative for
     every number, date, rating, and transaction. NEVER invent or
     contradict it. Use web search (up to ${WEB_SEARCH_MAX_USES} searches) only to fill
     narrative gaps: transcript quotes, analyst rationale, dated upcoming
     catalysts, this week's market story.
   • Every paragraph and bullet carries at least one citation:
     [STRUCTURED:<field>] for ground-truth claims, [WEB:<url>] for web
     claims. "Recently" without a date is forbidden; "strong
     fundamentals" without a metric is forbidden.
   • Goldman-initiation-note depth. No preamble — open directly with
     ## Snapshot.

STEP 2 — call submit_thesis ONCE with your decision. The schema documents
every field; the judgment rules:

   • direction: LONG / SHORT / PASS. PASS is a valid, gradeable outcome —
     use it when the research doesn't support a directional edge from
     YOUR strategy's angle${opts.mode === "refresh" ? " (on a refresh, a PASS view is flagged for the orchestrator; the stored direction doesn't change)" : ""}.
   • R/R FLOOR — 2:1 MANDATORY. LONG: (target−entry)/(entry−stop);
     SHORT: (entry−target)/(stop−entry). Below 2:1 the tool rejects:
     tighten the stop to a REAL technical level, raise the target to a
     CITED level, or go PASS. Never fabricate levels to clear the gate.
   • SETUP FIRST. Name the setup (setup_id) from YOUR SETUPS, then take
     every number from its rules and the Price structure block — never a
     round number, never a feel:
       – entry_price: the level the setup's entry rule gives (the base
         pivot for a breakout, the moving average for a pullback). It
         BECOMES the buy trigger. When the setup's condition is already
         true today, set it at or a few cents past the live price — that
         is how you buy now; it fires on the first tick through it and
         becomes the ordinary approval-gated proposal. A breakout wants
         entry_on_close: true (an intraday poke fails about half the
         time). Never more than the setup's chase limit past its pivot.
       – stop_loss: under the structure the setup names, at least its
         minimum ATR from entry. stop_basis says which structure and how
         many ATR, with the numbers.
       – target_price: the setup's target rule (measured move, prior
         high, R multiple), ≥ 2R. target_basis says which, with the
         numbers.
     If no setup fits the chart, the answer is PASS or an unpriced view
     — not a plan with invented levels.
   • A SETUP HAS A WINDOW AND PRECONDITIONS (its Needs line). When the
     window has closed or the stop it names can't be placed, the next
     setup on your list is the plan: a stock past its drift window in an
     uptrend is written on MA_PULLBACK — buy at the rising 20- or 50-day,
     stop 1 ATR under it until the pullback low prints, target the prior
     high. A REVIEW at the price you would buy is a plan you did not
     write: make it the buy, or PASS and say why the stock isn't buyable
     there.
   • NO LEVEL WORTH WAITING FOR YET (the entry window opens later, the
     setup hasn't formed, you want to price it after the print) → omit
     ALL THREE of entry/target/stop. The thesis stays LONG/SHORT and
     WATCHING and is priced when the time comes. It MUST carry the wake
     that brings it back, in \`triggers\`: a REVIEW at the price you'd
     look again, or a short day-count review. A watch has no review
     clock unless you give it one, so a view saved with no entry, no
     trigger and no review can never come back. "I want to price the
     pullback rather than buy here" IS a level: write the pullback as
     the buy (the rising 20- or 50-day, stop 1 ATR under it).
     Put the when ("price this after the January readout") in the
     rationale.
     PASS is for a view the research does not support — not for a view
     that isn't ready to price.
   • core_belief: ONE falsifiable sentence = outcome + timeframe +
     mechanism ("NVDA prints ≥$50B DC revenue by Q4 FY26 as Blackwell
     replaces Hopper"). It is THE claim of record every other agent
     reads. Current-state descriptions belong in Snapshot, not here.
   • conviction is YOUR REAL VIEW, independent of composite: STRONG =
     top 2-3 calls per cycle, urgent; HIGH = clear edge, want it in
     size; MEDIUM = the honest middle (most theses); LOW = tracking,
     not enthusiastic. STRONG/HIGH require a variant_view — no variant
     view means your tier is MEDIUM. conviction_rationale is the
     judgment in plain speech, NOT a paraphrase of the scoring object.
   • You do not size the trade. place_trade sizes it by risk from your
     stop: the account loses about the analyst's risk per trade if the
     stop hits, scaled by conviction (LOW ×0.5 … STRONG ×1.25). A tight,
     honest stop is what earns size.
   • confidence context: this analyst's minimum confidence for
     trade-eligible coverage is ${opts.minConfidence}/100 — calibrate composite +
     conviction honestly against that bar.${
       opts.setupRecord?.length
         ? `\n   • your record by setup (closed trades since 2026-05-27):\n${opts.setupRecord.map((l) => `       ${l}`).join("\n")}`
         : ""
     }
   • entryQuality scores the setup's own entry rule: 2 = its condition is
     true today (inside the chase limit), 1 = within a few percent of it,
     0 = not formed. Never distance from the 52-week high by itself.

${triggerBlock}
${earningsTriggerBlock}
${priorExitBlock}
If submit_thesis returns validation errors, fix EXACTLY the listed fields
and call it again — do NOT rewrite the research note. When it returns
accepted, STOP. Do not write anything after acceptance.`;
}

// ── Idempotency guard ───────────────────────────────────────────────────

/**
 * Fast no-op when a prior attempt already drove the child run to COMPLETE
 * (GAPS P1-17, PR #383). V1 needed this because the whole agent ran in one
 * 333-760s Inngest step that the platform would abandon and re-invoke. V2
 * runs each phase in its own step (completed phases memoize), but the
 * guard stays: it makes a full-function retry after a completed run a
 * cheap no-op, and it protects the direct-call path (backfill script).
 * Only COMPLETE short-circuits — a FAILED first attempt must still retry.
 * Fail-open on read errors.
 */
export async function writerIdempotencyCheck(
  args: Pick<RunThesisWriterArgs, "childRunId" | "mode" | "existingThesisId" | "ticker">,
): Promise<RunThesisWriterResult | null> {
  const T = args.ticker.toUpperCase();
  try {
    const prior = await prisma.researchRun.findUnique({
      where: { id: args.childRunId },
      select: { status: true },
    });
    if (prior?.status === "COMPLETE") {
      let thesisId: string | null = null;
      if (args.mode === "mint") {
        const minted = await prisma.thesis.findFirst({
          where: { researchRunId: args.childRunId, ticker: T },
          select: { id: true },
          orderBy: { createdAt: "desc" },
        });
        thesisId = minted?.id ?? null;
      } else if (args.existingThesisId) {
        const touch = await prisma.thesisUpdate.findFirst({
          where: { runId: args.childRunId, thesisId: args.existingThesisId },
          select: { thesisId: true },
        });
        thesisId = touch?.thesisId ?? null;
      }
      console.log(
        `[thesis-writer] IDEMPOTENT no-op ticker=${T} child=${args.childRunId}: prior attempt already COMPLETE (thesisId=${thesisId}); skipping re-run.`,
      );
      return {
        childRunId: args.childRunId,
        status: "COMPLETE",
        thesisId,
        steps: 0,
        toolCalls: 0,
        elapsedMs: 0,
      };
    }
  } catch (guardErr) {
    console.warn(
      `[thesis-writer] idempotency guard read failed for child=${args.childRunId}; proceeding with normal run:`,
      guardErr instanceof Error ? guardErr.message : guardErr,
    );
  }
  return null;
}

// ── Phase events (best-effort, never throw) ─────────────────────────────

async function writePhaseEvent(
  runId: string,
  title: string,
  message: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.runEvent.create({
      data: { runId, type: "writer_phase", title, message, payload: payload as object },
    });
  } catch {
    /* best-effort */
  }
}

// ── Phase P: pull ───────────────────────────────────────────────────────

export interface WriterPullPhaseOutput {
  ok: boolean;
  pull: ThesisPullResult | null;
  error?: string;
}

export async function writerPullPhase(
  args: RunThesisWriterArgs,
): Promise<WriterPullPhaseOutput> {
  const T = args.ticker.toUpperCase();
  try {
    const analyst = await loadWriterAnalyst(args.analystId);
    if (!analyst) return { ok: false, pull: null, error: `Analyst ${args.analystId} not found` };
    const ctx = await buildWriterToolCtx(args, analyst);
    const pull = await pullThesisData(T, ctx);
    await writePhaseEvent(
      args.childRunId,
      "Data pulled",
      `7 parallel pulls${pull.pullErrors.length ? ` — ${pull.pullErrors.length} failed or empty: ${pull.pullErrors.join(", ")}` : " — all sources returned data"}. Live price: ${pull.currentPrice ?? "unavailable"}.`,
      { ticker: T, pullErrors: pull.pullErrors, currentPrice: pull.currentPrice },
    );
    return { ok: true, pull };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[thesis-writer] pull phase failed ticker=${T} child=${args.childRunId}: ${msg}`);
    await writePhaseEvent(args.childRunId, "Data pull failed", msg, { ticker: T });
    return { ok: false, pull: null, error: `Data pull failed: ${msg}` };
  }
}

// ── Phase R: research ───────────────────────────────────────────────────

export interface WriterResearchPhaseOutput {
  ok: boolean;
  noteText: string;
  /** The validated decision object, JSON-safe. Null when never accepted. */
  decision: ValidatedThesisDecision | null;
  riskReward: number | null;
  /** Serialized ModelMessages for the replay thread (user turn excluded). */
  threadMessages: unknown[];
  /** The user prompt (data block + task) for the replay thread. */
  userPrompt: string;
  /** The research system prompt — the save-time retry resubmits under it. */
  systemPrompt?: string;
  stepCount: number;
  toolCallCount: number;
  submitAttempts: number;
  sectionCount: number;
  error?: string;
}

export async function writerResearchPhase(
  args: RunThesisWriterArgs,
  pullOutput: WriterPullPhaseOutput,
): Promise<WriterResearchPhaseOutput> {
  const T = args.ticker.toUpperCase();
  const empty: WriterResearchPhaseOutput = {
    ok: false,
    noteText: "",
    decision: null,
    riskReward: null,
    threadMessages: [],
    userPrompt: "",
    stepCount: 0,
    toolCallCount: 0,
    submitAttempts: 0,
    sectionCount: 0,
  };

  try {
    const analyst = await loadWriterAnalyst(args.analystId);
    if (!analyst) return { ...empty, error: `Analyst ${args.analystId} not found` };

    const existingThesis =
      args.mode === "refresh" && args.existingThesisId
        ? await loadExistingThesis(args.existingThesisId)
        : null;
    if (args.mode === "refresh" && args.existingThesisId && !existingThesis) {
      return { ...empty, error: `Existing thesis ${args.existingThesisId} not found` };
    }

    const rawDataBlock =
      pullOutput.pull?.rawDataBlock ??
      `(Structured data pulls failed entirely: ${pullOutput.error ?? "unknown"}. Ground your note in web research and say so explicitly in the Snapshot.)`;
    const currentPrice = pullOutput.pull?.currentPrice ?? null;


    // ── P1-35 (#524): recently-sold context for mints ───────────────────
    // record_thesis refuses a mint at/above a ≤14-day exit price without an
    // explicit acknowledge_prior_exit. Surface the exit into the prompt and
    // require the acknowledgment in-loop so the model engages with the sale
    // instead of the run dying at persist.
    let priorExit: {
      exitPrice: number | null;
      daysAgo: number;
      closeReason: string | null;
    } | null = null;
    if (args.mode === "mint") {
      try {
        const soldSibling = await prisma.thesis.findFirst({
          where: {
            ticker: T,
            status: "RETIRED",
            retiredReason: "SOLD",
            closedAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
            researchRun: { agentConfigId: analyst.id },
          },
          orderBy: { closedAt: "desc" },
          select: { id: true, closedAt: true, closeReason: true },
        });
        if (soldSibling?.closedAt) {
          const closedRow = await prisma.thesisUpdate.findFirst({
            where: { thesisId: soldSibling.id, type: "CLOSED" },
            orderBy: { timestamp: "desc" },
            select: { priceAtTime: true },
          });
          const exitPrice =
            closedRow?.priceAtTime != null && Number.isFinite(Number(closedRow.priceAtTime))
              ? Number(closedRow.priceAtTime)
              : null;
          priorExit = {
            exitPrice,
            daysAgo: Math.floor((Date.now() - soldSibling.closedAt.getTime()) / 86_400_000),
            closeReason: soldSibling.closeReason ?? null,
          };
        }
      } catch {
        /* non-fatal — persist-side guard still enforces */
      }
    }

    // The playbook's numbers as this account set them (DAV-273).
    const seatSetups = setupsForAnalyst(analyst.setupIds, await loadSetupOverrides(analyst.accountId));
    const systemPrompt = buildWriterResearchPrompt({
      analystName: analyst.name,
      analystPrompt: analyst.analystPrompt,
      ticker: T,
      mode: args.mode,
      existingThesis,
      reason: args.reason,
      minConfidence: analyst.minConfidence,
      runDate: new Date().toISOString().slice(0, 10),
      promotionContext: args.promotionContext ?? null,
      priorExit,
      setups: seatSetups,
      setupRecord: await loadScorecardLines({
        accountId: analyst.accountId,
        analystId: analyst.id,
        environment: analyst.tradingEnvironment ?? "PAPER",
      }),
    });
    const userPrompt = `═══════════════════════════════════════════════════════════════════
GROUND-TRUTH DATA — use these numbers; do not invent or contradict
═══════════════════════════════════════════════════════════════════
${rawDataBlock}

Write the research note now, then call submit_thesis.`;

    const modeConfig = MODES["thesis-writer"];
    const model =
      modeConfig.provider === "anthropic"
        ? anthropic(modeConfig.model as Parameters<typeof anthropic>[0])
        : openai(modeConfig.model);

    let accepted: ValidatedThesisDecision | null = null;
    let acceptedRR: number | null = null;
    let submitAttempts = 0;
    let lastRejected: { raw: unknown; errors: string[] } | null = null;

    // The save's own check, run in check-only mode from the submit step.
    const saveCtx = await buildWriterToolCtx(args, analyst);
    const submitThesisTool = makeSubmitThesisTool({
      ticker: T,
      onReject: (raw, errors) => {
        lastRejected = { raw, errors };
      },
      validate: {
        mode: args.mode,
        existingStatus: existingThesis?.status ?? null,
        currentPrice,
        // Persist-gate mirrors (goalpost + zero-trigger) need the
        // existing row's shape — see decision.ts review-finding-#4 block.
        existingTargetPrice: existingThesis?.targetPrice ?? null,
        setups: seatSetups,
        chart: pullOutput.pull?.chart ?? null,
      },
      check: (d) =>
        checkDecisionAgainstSave({
          args,
          pull: pullOutput.pull,
          decision: d,
          ctx: saveCtx,
          existing: existingThesis
            ? { direction: existingThesis.direction, status: existingThesis.status }
            : null,
        }),
      onAttempt: () => ++submitAttempts,
      onAccept: (d, rr) => {
        accepted = d;
        acceptedRR = rr;
      },
    });

    // Accumulate text + messages step-by-step so a timeout mid-run still
    // leaves a persistable thread (V1's timeout path persisted NOTHING —
    // the runs that most needed debugging left no trace).
    const capturedMessages: ModelMessage[] = [];
    const noteParts: string[] = [];
    let stepCount = 0;
    let toolCallCount = 0;
    let searchCount = 0;

    const tools =
      modeConfig.provider === "anthropic"
        ? {
            // The basic search, called directly. The 20260209 version runs
            // its "dynamic filtering" through a code-execution tool that this
            // loop never provides, so the model spent research steps calling
            // a tool that couldn't exist ("unavailable tool 'code_execution'",
            // 6 of 43 writer runs from 09-11, and every step it burned was a
            // step the submit repair needed on 09-25). DAV-316.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            web_search: anthropic.tools.webSearch_20250305({ maxUses: WEB_SEARCH_MAX_USES }) as any,
            submit_thesis: submitThesisTool,
          }
        : { submit_thesis: submitThesisTool };

    let loopError: string | null = null;
    try {
      await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: tools as any,
        stopWhen: [stepCountIs(modeConfig.maxSteps), () => accepted !== null],
        abortSignal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
        onStepFinish(step) {
          stepCount++;
          toolCallCount += step.toolCalls.length;
          searchCount += step.toolCalls.filter((c) => c.toolName === "web_search").length;
          if (step.text) noteParts.push(step.text);
          // step.response.messages is the CUMULATIVE whole-call array
          // (ai@6.0.116 structuredClones responseMessages per step) —
          // REPLACE, don't append, or the thread duplicates step 1's
          // messages N times (review finding #2). The last snapshot is the
          // full conversation so far, which is exactly what a mid-run
          // abort should persist.
          capturedMessages.length = 0;
          capturedMessages.push(...(step.response?.messages ?? []));
          console.log(
            `[thesis-writer] STEP #${stepCount} child=${args.childRunId} ticker=${T} tools=[${step.toolCalls.map((c) => c.toolName).join(", ") || "none"}] text=${step.text?.length ?? 0}ch`,
          );
        },
      });
    } catch (err) {
      loopError = err instanceof Error ? err.message : String(err);
      console.error(
        `[thesis-writer] research loop error ticker=${T} child=${args.childRunId}: ${loopError}`,
      );
    }

    let noteText = noteParts.join("\n\n");
    let sections = parseIntoSections(noteText);
    let sectionCount = Object.keys(sections).length;

    // One targeted repair turn when the decision landed but the note is
    // materially incomplete. Cheap (text-only, no tools) and rare.
    if (accepted && !loopError && sectionCount < MIN_SECTIONS_BEFORE_REPAIR) {
      const have = new Set(Object.keys(sections));
      const wanted = [
        ["snapshot", "## Snapshot"],
        ["recentCatalysts", "## Recent Catalysts"],
        ["fundamentals", "## Fundamentals"],
        ["latestEarnings", "## Latest Earnings"],
        ["catalystsAndEvents", "## Catalysts & Events"],
        ["bullCase", "## Bull Case"],
        ["bearCase", "## Bear Case"],
        ["analystConsensus", "## Analyst Consensus"],
        ["insiderTechnical", "## Insider & Technical"],
      ].filter(([key]) => !have.has(key));
      try {
        // TEXT-ONLY continuation (review finding #3): replaying
        // capturedMessages here would send tool_use/tool_result blocks
        // (submit_thesis + server web_search) to a call with NO tools
        // param — the API rejects that with a 400, which made the repair
        // path dead on arrival. The note text is all the repair needs.
        const repair = await generateText({
          model,
          system: systemPrompt,
          messages: [
            { role: "user", content: userPrompt },
            { role: "assistant", content: noteText || "(no note text produced yet)" },
            {
              role: "user",
              content: `The note is missing these sections: ${wanted.map(([, h]) => h).join(", ")}. Write ONLY the missing sections now, in the exact template format with citations. No other text.`,
            },
          ],
          abortSignal: AbortSignal.timeout(SECTION_REPAIR_TIMEOUT_MS),
        });
        if (repair.text) {
          noteText = `${noteText}\n\n${repair.text}`;
          capturedMessages.push(...(repair.response?.messages ?? []));
          sections = parseIntoSections(noteText);
          sectionCount = Object.keys(sections).length;
        }
      } catch (repairErr) {
        console.warn(
          `[thesis-writer] section repair failed (continuing with ${sectionCount} sections):`,
          repairErr instanceof Error ? repairErr.message : repairErr,
        );
      }
    }

    // ── Decision repair: a refused submit is fixed, not abandoned ────────
    // The loop can end on a refused submit_thesis with the research done
    // and the decision one field off — the step budget spent (IBRX, BBIO,
    // DYN on 2026-09-25: four of five catalyst dispatches lost that way).
    // The refusal goes back to the model with the note it wrote, through
    // the same submit tool, on its own budget. The Run Book promised this.
    const rejected = lastRejected as { raw: unknown; errors: string[] } | null;
    if ((accepted as ValidatedThesisDecision | null) === null && rejected && !loopError) {
      await writePhaseEvent(
        args.childRunId,
        "Decision refused — repairing",
        rejected.errors.join(" | "),
        { ticker: T, submitAttempts },
      );
      const repaired = await resubmitWithFeedback({
        args,
        pullOutput,
        systemPrompt,
        userPrompt,
        noteText,
        analyst,
        existing: existingThesis,
        ctx: saveCtx,
        previous: rejected.raw,
        feedback: `submit_thesis refused it:\n- ${rejected.errors.join("\n- ")}`,
      });
      submitAttempts += repaired.attempts;
      capturedMessages.push(...repaired.messages);
      if (repaired.decision) {
        accepted = repaired.decision;
        acceptedRR = repaired.riskReward;
      }
    }

    // Read the closure-mutated flags into locals. TS's control-flow
    // analysis can't see the submit_thesis execute callback's assignments
    // (microsoft/TypeScript#9998), so without the assertion `accepted`
    // stays narrowed to its `null` initializer here.
    const finalDecision = accepted as ValidatedThesisDecision | null;
    const finalRR = acceptedRR as number | null;

    const result: WriterResearchPhaseOutput = {
      ok: finalDecision !== null,
      noteText,
      decision: finalDecision,
      riskReward: finalRR,
      threadMessages: capturedMessages as unknown[],
      userPrompt,
      systemPrompt,
      stepCount,
      toolCallCount,
      submitAttempts,
      sectionCount,
      error:
        finalDecision !== null
          ? undefined
          : loopError ??
            (submitAttempts > 0
              ? `submit_thesis never passed validation (${submitAttempts} attempt${submitAttempts === 1 ? "" : "s"})`
              : "model produced no submit_thesis call"),
    };

    await writePhaseEvent(
      args.childRunId,
      result.ok ? "Research complete" : "Research failed",
      result.ok && finalDecision
        ? `${sectionCount}/9 sections, ${searchCount} web search${searchCount === 1 ? "" : "es"}, decision ${finalDecision.direction} (${finalDecision.conviction ?? "—"}), submit attempts: ${submitAttempts}.`
        : result.error ?? "unknown",
      {
        ticker: T,
        sectionCount,
        searchCount,
        submitAttempts,
        direction: finalDecision?.direction ?? null,
        riskReward: finalRR,
      },
    );

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[thesis-writer] research phase failed ticker=${T} child=${args.childRunId}: ${msg}`);
    await writePhaseEvent(args.childRunId, "Research failed", msg, { ticker: T });
    return { ...empty, error: msg };
  }
}

// ── Phase Z: persist + finalize ─────────────────────────────────────────

type SectionArgs = Partial<
  Record<
    | "snapshot"
    | "recent_catalysts"
    | "fundamentals"
    | "latest_earnings"
    | "catalysts_and_events"
    | "bull_case"
    | "bear_case"
    | "analyst_consensus"
    | "insider_technical",
    unknown
  >
>;

/**
 * Map a raw parsed citation marker ("WEB:https://…" / "STRUCTURED:field")
 * to record/update_thesis's sectionCitationSchema OBJECT shape
 * ({ kind, url?, title?, domain? }). Review finding #1: the parser emits
 * raw STRINGS, the persist schema wants objects — splatting the strings
 * through fails Zod on every section that has citations, i.e. every run
 * that followed the prompt. (V1 survived this only because the relay
 * model reshaped citations by hand — part of its 60% first-attempt
 * bounce rate.)
 */
export function toCitationObject(raw: string): {
  kind: "STRUCTURED" | "WEB";
  url?: string;
  title?: string;
  domain?: string;
} {
  const colon = raw.indexOf(":");
  const kindStr = colon > 0 ? raw.slice(0, colon).toUpperCase() : "";
  const ref = colon > 0 ? raw.slice(colon + 1) : raw;
  if (kindStr === "WEB") {
    let domain: string | undefined;
    try {
      domain = new URL(ref).hostname;
    } catch {
      /* malformed url — leave domain undefined */
    }
    return { kind: "WEB", url: ref, ...(domain ? { domain } : {}) };
  }
  return { kind: "STRUCTURED", title: ref };
}

function toSchemaTextSection(s: { text: string; citations: string[] }) {
  return { text: s.text, citations: s.citations.map(toCitationObject) };
}

function toSchemaBulletSection(s: { bullets: Array<{ text: string; citation?: string }> }) {
  return {
    bullets: s.bullets.map((b) => ({
      text: b.text,
      ...(b.citation !== undefined ? { citation: toCitationObject(b.citation) } : {}),
    })),
  };
}

export function sectionArgsFrom(sections: ParsedSections): SectionArgs {
  const out: SectionArgs = {};
  if (sections.snapshot) out.snapshot = toSchemaTextSection(sections.snapshot);
  if (sections.recentCatalysts) out.recent_catalysts = toSchemaTextSection(sections.recentCatalysts);
  if (sections.fundamentals) out.fundamentals = toSchemaTextSection(sections.fundamentals);
  if (sections.latestEarnings) out.latest_earnings = toSchemaBulletSection(sections.latestEarnings);
  if (sections.catalystsAndEvents) out.catalysts_and_events = toSchemaBulletSection(sections.catalystsAndEvents);
  if (sections.bullCase) out.bull_case = toSchemaBulletSection(sections.bullCase);
  if (sections.bearCase) out.bear_case = toSchemaBulletSection(sections.bearCase);
  if (sections.analystConsensus) out.analyst_consensus = toSchemaTextSection(sections.analystConsensus);
  if (sections.insiderTechnical) out.insider_technical = toSchemaTextSection(sections.insiderTechnical);
  return out;
}

interface PersistToolEnvelope {
  /** defineTool's envelope: `ok:false` + `error` when execute() threw. */
  ok?: boolean;
  error?: string;
  data?: Record<string, unknown>;
  summary?: string;
}

/**
 * Run server-built args through the tool's OWN input schema, then execute.
 * Direct .execute() calls bypass the AI SDK's Zod validation layer, which
 * is where .default() values (source_signal_ids: [], trigger ids)
 * and the cross-field superRefine rules are applied — skipping it would
 * hand the tool a shape it never sees in production. A parse failure here
 * is a server-side construction bug, surfaced loudly as the persist error.
 */
async function executeThroughSchema(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolInstance: any,
  toolName: string,
  args: Record<string, unknown>,
): Promise<PersistToolEnvelope | { __schemaError: string }> {
  const schema = toolInstance?.inputSchema as
    | { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ path: Array<string | number>; message: string }> } } }
    | undefined;
  let finalArgs: unknown = args;
  if (schema && typeof schema.safeParse === "function") {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const issues = (parsed.error?.issues ?? [])
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return { __schemaError: `${toolName} args failed schema validation: ${issues}` };
    }
    finalArgs = parsed.data;
  }
  return (await toolInstance.execute(finalArgs, {
    toolCallId: "thesis-writer-persist",
    messages: [] as never[],
  })) as PersistToolEnvelope;
}

/** The save call a decision becomes — one builder for the check and the save. */
export interface WriterSaveCall {
  toolName: "record_thesis" | "update_thesis";
  toolArgs: Record<string, unknown>;
}

/**
 * Build the record_thesis (mint) / update_thesis (refresh) args for a
 * decision. The submit step's check and the real save both call this, so
 * the args the check approves are the args the save receives.
 */
export function buildWriterSaveCall(
  args: RunThesisWriterArgs,
  pull: WriterPullPhaseOutput["pull"],
  d: ValidatedThesisDecision,
  sectionArgs: SectionArgs,
  existing: { direction: string | null; status: string | null } | null,
): WriterSaveCall {
  const T = args.ticker.toUpperCase();
  // The event date is the company's, when it announced one. The writer
  // sees it in the data block; if its decision still carries a different
  // date, the filing's wins and the substitution is written on the stock
  // (EXEL 2026-09-25: the note guessed a slipped 2027-03-03, the 8-K said
  // 2026-12-03, and every review counted from the guess).
  const eventDate = resolveEventDate(d, pull);
  const notes = [...(d.notes ?? []), ...(eventDate.note ? [eventDate.note] : [])];
  const rationale = notes.length ? `${d.rationale}\n\n${notes.map((n) => `[${n}]`).join("\n")}` : d.rationale;
  if (args.mode === "mint") {
    return {
      toolName: "record_thesis",
      toolArgs: {
        ticker: T,
        company_name: pull?.companyName ?? undefined,
        exchange: pull?.exchange ?? undefined,
        direction: d.direction,
        // Writer mints are always entry-gated coverage; PASS derives its
        // own terminal state inside record_thesis.
        status: d.direction === "PASS" ? undefined : "WATCHING",
        reasoning_summary: rationale,
        entry_price: d.entry_price,
        target_price: d.target_price,
        stop_loss: d.stop_loss,
        setup_id: d.direction === "PASS" ? undefined : d.setup_id,
        stop_basis: d.stop_basis,
        target_basis: d.target_basis,
        entry_on_close: d.entry_on_close,
        // The price the research was done at. record_thesis reads the buy
        // level's side (pullback vs breakout) off it when its own quote
        // fails — and refuses rather than guesses when both are missing.
        current_price: pull?.currentPrice ?? undefined,
        horizon: d.horizon,
        catalyst_date: eventDate.iso,
        scoring: d.scoring,
        conviction: d.conviction,
        conviction_rationale: d.conviction_rationale,
        variant_view: d.variant_view,
        core_belief: d.core_belief,
        key_assumptions: d.key_assumptions,
        invalidation_conditions: d.invalidation_conditions,
        // PASS theses cannot carry triggers (record_thesis gate) — the
        // validator rejects this too; strip defensively.
        triggers:
          d.direction === "PASS"
            ? undefined
            : args.reviewCadenceDays
              ? [
                  ...(d.triggers ?? []),
                  {
                    predicate: { kind: "REVIEW_CADENCE", days: args.reviewCadenceDays },
                    action: "REVIEW",
                    rationale: `Look at this every ${args.reviewCadenceDays} day(s), from the last review.`,
                  },
                ]
              : d.triggers,
        // P1-35: pass the model's engagement with a recent sale through
        // to record_thesis's recently-sold gate.
        acknowledge_prior_exit: d.prior_exit_acknowledgment,
        source_kind: "WEB_SEARCH",
        source_rationale: args.reason.slice(0, 300),
        research_data: pull?.rawDataBlock,
        ...sectionArgs,
      },
    };
  }
  // Role split (docs/THESIS_ARCHITECTURE.md §0): the writer refreshes
  // research; it NEVER changes direction or status. A changed view is
  // flagged in the rationale for the orchestrator to act on.
  const directionFlag =
    existing?.direction && d.direction !== existing.direction
      ? ` ⚠ Writer's refreshed view is ${d.direction} vs stored ${existing.direction} — orchestrator should re-evaluate direction.`
      : "";
  // On a stock we own, the entry is the fill — update_thesis refuses an edit
  // to it and lands the rest of the call. The writer's own rules still make
  // it state all three levels on a priced row, so it always sent one and the
  // refusal was never heard (FIVE, 2026-09-15). Don't send it.
  const held = existing?.status === "HOLDING";
  // Held refresh: protective levels only tighten (the 2026-08-16 ruling). A
  // looser stop is refused as its own op inside update_thesis and the rest
  // of the refresh lands (DAV-242).
  const pass = d.direction === "PASS";
  return {
    toolName: "update_thesis",
    toolArgs: {
      thesis_id: args.existingThesisId,
      rationale: `${rationale}${directionFlag}`,
      // Always supplied: the P0-1 gate refuses price moves when the belief
      // text happens to be unchanged; the writer's judgment on why lives in
      // the decision rationale.
      structural_unchanged_reason: d.rationale,
      entry_price: pass || held ? undefined : d.entry_price,
      target_price: pass ? undefined : d.target_price,
      stop_loss: pass ? undefined : d.stop_loss,
      setup_id: pass ? undefined : d.setup_id,
      stop_basis: pass ? undefined : d.stop_basis,
      target_basis: pass ? undefined : d.target_basis,
      entry_on_close: pass || held ? undefined : d.entry_on_close,
      horizon: d.horizon,
      catalyst_date: eventDate.iso,
      scoring: d.scoring,
      conviction: d.conviction,
      conviction_rationale: d.conviction_rationale,
      variant_view: d.variant_view,
      core_belief: d.core_belief,
      key_assumptions: d.key_assumptions,
      invalidation_conditions: d.invalidation_conditions,
      add_triggers: d.add_triggers,
      edit_triggers: d.edit_triggers,
      remove_trigger_ids: d.remove_trigger_ids,
      price_at_time: pull?.currentPrice ?? undefined,
      research_data: pull?.rawDataBlock,
      ...sectionArgs,
    },
  };
}

export { resolveEventDate } from "@/lib/agent/thesis-research/catalyst-on-file";

/** How a save (or a check-only save) came back. */
export interface WriterSaveOutcome {
  /** Row id the save wrote (always null for a check-only call). */
  thesisId: string | null;
  /** A check-only call that would have saved. */
  wouldSave: boolean;
  /** Why it didn't save, in the save's own words. */
  error: string | null;
  /** A refusal or schema miss the model can fix — not a crash. */
  fixable: boolean;
}

/**
 * Read a record_thesis / update_thesis envelope. Shared by the check and the
 * save so "refused" means the same thing in both.
 */
export function readWriterSaveResult(
  toolName: WriterSaveCall["toolName"],
  res: PersistToolEnvelope | { __schemaError: string },
): WriterSaveOutcome {
  if ("__schemaError" in res) {
    return { thesisId: null, wouldSave: false, error: res.__schemaError, fixable: true };
  }
  if (res.ok === false) {
    // The tool threw (e.g. a Prisma error). defineTool's envelope carries the
    // message at the top level, not in `data`. Not the model's to fix.
    return { thesisId: null, wouldSave: false, error: `${toolName} failed: ${res.error ?? res.summary ?? "unknown"}`, fixable: false };
  }
  const data = res?.data ?? {};
  if (data.dry_run === true) {
    // A save lands the rest of the call when one trigger edit is refused, and
    // reports that edit by id. The run ends at the save, so the writer never
    // hears it: the thesis text says one thing and the trigger says another
    // until some later run reads the stock. The check hands it back while the
    // writer still has its research (Dave's ruling, 2026-09-15).
    const refused = (Array.isArray(data.trigger_ops) ? data.trigger_ops : []).filter(
      (op): op is { id?: string; text?: string; reason?: string } =>
        !!op && typeof op === "object" && (op as { ok?: boolean }).ok === false,
    );
    if (refused.length > 0) {
      return {
        thesisId: null,
        wouldSave: false,
        fixable: true,
        error: `${toolName} would save, but ${refused.length} trigger change${refused.length === 1 ? "" : "s"} would be refused: ${refused
          .map((op) => `${op.text ?? op.id ?? "trigger"} — ${op.reason ?? "refused"}`)
          .join(" · ")}`,
      };
    }
    return { thesisId: null, wouldSave: true, error: null, fixable: false };
  }
  if (toolName === "record_thesis") {
    if (typeof data.thesis_id === "string" && data.thesis_id) {
      return { thesisId: data.thesis_id, wouldSave: false, error: null, fixable: false };
    }
    return { thesisId: null, wouldSave: false, error: `record_thesis refused: ${String(data.note ?? data.error ?? res?.summary ?? "unknown")}`, fixable: true };
  }
  if (data.ok === false) {
    return { thesisId: null, wouldSave: false, error: `update_thesis refused: ${String(data.message ?? data.error ?? res?.summary ?? "unknown")}`, fixable: true };
  }
  // update_thesis said ok; the caller proves it with the audit row.
  return { thesisId: null, wouldSave: false, error: null, fixable: false };
}

/**
 * The writer's own check IS the save: run the exact args through
 * record_thesis / update_thesis in check-only mode (ctx.dryRun) — the same
 * input schema, trigger ops, plan check and status rules — and stop before
 * the write. Sections are left out: they're built by the server from the
 * note, not chosen by the model, and the save-time retry covers them.
 */
export async function checkDecisionAgainstSave(input: {
  args: RunThesisWriterArgs;
  pull: WriterPullPhaseOutput["pull"];
  decision: ValidatedThesisDecision;
  ctx: ToolContext;
  existing: { direction: string | null; status: string | null } | null;
}): Promise<WriterSaveOutcome> {
  const call = buildWriterSaveCall(input.args, input.pull, input.decision, {}, input.existing);
  const checkCtx: ToolContext = { ...input.ctx, dryRun: true };
  const toolInstance = call.toolName === "record_thesis" ? recordThesis(checkCtx) : updateThesis(checkCtx);
  try {
    return readWriterSaveResult(call.toolName, await executeThroughSchema(toolInstance, call.toolName, call.toolArgs));
  } catch (err) {
    return { thesisId: null, wouldSave: false, error: err instanceof Error ? err.message : String(err), fixable: false };
  }
}

/** How many times the submit step hands a save refusal back before letting the save speak. */
const SAVE_CHECK_REFUSALS_BEFORE_PASS = 2;

/**
 * The submit_thesis tool: the decision's own rules, then the save's check.
 * Used by the research loop and by the one save-time retry.
 */
export function makeSubmitThesisTool(opts: {
  validate: Parameters<typeof validateThesisDecision>[1];
  check: (d: ValidatedThesisDecision) => Promise<WriterSaveOutcome>;
  onAccept: (d: ValidatedThesisDecision, riskReward: number | null) => void;
  onAttempt: () => number;
  /** The last refused submit, kept so the repair step can hand it back. */
  onReject?: (raw: unknown, errors: string[]) => void;
  ticker: string;
}) {
  let saveRefusals = 0;
  return tool({
    description:
      "Submit your final thesis decision. Call ONCE after the research note is fully written. " +
      "If the result lists validation errors, fix exactly those fields and call again.",
    inputSchema: thesisDecisionSchema,
    // Grammar-constrained: the model cannot emit an input outside the
    // schema — no invented trigger kind, no missing required field. The
    // schema is built strict-clean in decision.ts / model-schema.ts. Only
    // Anthropic's strict mode is meant here; OpenAI's has different rules.
    strict: MODES["thesis-writer"].provider === "anthropic",
    execute: async (raw: z.infer<typeof thesisDecisionSchema>) => {
      const attempt = opts.onAttempt();
      const v = validateThesisDecision(raw, opts.validate);
      if (!v.ok) {
        console.log(
          `[thesis-writer] submit_thesis attempt ${attempt} rejected ticker=${opts.ticker}: ${v.errors.length} error(s)`,
        );
        opts.onReject?.(raw, v.errors);
        return {
          accepted: false,
          errors: v.errors,
          instruction: "Fix exactly these fields and call submit_thesis again. Do NOT rewrite the research note.",
        };
      }
      if (saveRefusals < SAVE_CHECK_REFUSALS_BEFORE_PASS) {
        const saved = await opts.check(v.decision!);
        if (!saved.wouldSave && saved.fixable && saved.error) {
          saveRefusals++;
          console.log(
            `[thesis-writer] submit_thesis attempt ${attempt} refused by the save check ticker=${opts.ticker}: ${saved.error}`,
          );
          opts.onReject?.(raw, [`The save refused this decision — ${saved.error}`]);
          return {
            accepted: false,
            errors: [`The save refused this decision — ${saved.error}`],
            instruction: "Fix exactly what the save refused and call submit_thesis again. Do NOT rewrite the research note.",
          };
        }
      }
      opts.onAccept(v.decision!, v.riskReward ?? null);
      return {
        accepted: true,
        instruction: "Decision accepted and recorded. STOP — do not write anything further.",
      };
    },
  });
}

/** Save-time retry budget: the model sees the refusal and resubmits, once. */
const SAVE_RETRY_TIMEOUT_MS = 120_000;
const SAVE_RETRY_MAX_STEPS = 3;

/**
 * The one retry, for both refusals a decision can meet: the writer's own
 * check at the end of the research loop (the step budget ran out on a
 * refused submit), and the save (server-built sections, or the world moved
 * between check and save). Show the model its decision and the refusal, let
 * it resubmit through the same submit tool on a budget of its own, and
 * return the accepted decision — or null.
 */
async function resubmitWithFeedback(input: {
  args: RunThesisWriterArgs;
  pullOutput: WriterPullPhaseOutput;
  systemPrompt: string | undefined;
  userPrompt: string;
  noteText: string;
  analyst: WriterAnalyst;
  existing: WriterExistingThesis | null;
  ctx: ToolContext;
  /** What the model sent, exactly. */
  previous: unknown;
  /** The refusal, in the refuser's own words. */
  feedback: string;
}): Promise<{ decision: ValidatedThesisDecision | null; riskReward: number | null; attempts: number; messages: ModelMessage[] }> {
  const { args, pullOutput, analyst, existing } = input;
  if (!input.systemPrompt) return { decision: null, riskReward: null, attempts: 0, messages: [] };
  const T = args.ticker.toUpperCase();
  let accepted: ValidatedThesisDecision | null = null;
  let acceptedRR: number | null = null;
  let attempts = 0;
  const messages: ModelMessage[] = [];
  const submit = makeSubmitThesisTool({
    ticker: T,
    validate: {
      mode: args.mode,
      existingStatus: existing?.status ?? null,
      currentPrice: pullOutput.pull?.currentPrice ?? null,
      existingTargetPrice: existing?.targetPrice ?? null,
      setups: setupsForAnalyst(analyst.setupIds, await loadSetupOverrides(analyst.accountId)),
      chart: pullOutput.pull?.chart ?? null,
    },
    check: (d) =>
      checkDecisionAgainstSave({
        args,
        pull: pullOutput.pull,
        decision: d,
        ctx: input.ctx,
        existing: existing ? { direction: existing.direction, status: existing.status } : null,
      }),
    onAttempt: () => ++attempts,
    onAccept: (d, rr) => {
      accepted = d;
      acceptedRR = rr;
    },
  });
  const modeConfig = MODES["thesis-writer"];
  const model =
    modeConfig.provider === "anthropic"
      ? anthropic(modeConfig.model as Parameters<typeof anthropic>[0])
      : openai(modeConfig.model);
  try {
    const res = await generateText({
      model,
      system: input.systemPrompt,
      messages: [
        { role: "user", content: input.userPrompt },
        { role: "assistant", content: input.noteText || "(research note)" },
        {
          role: "user",
          content:
            `You submitted this decision:\n${JSON.stringify(input.previous)}\n\n` +
            `${input.feedback}\n\n` +
            "Call submit_thesis again with the decision fixed so it is accepted. Change only what the refusal names. Do not rewrite the note.",
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: { submit_thesis: submit } as any,
      stopWhen: [stepCountIs(SAVE_RETRY_MAX_STEPS), () => accepted !== null],
      abortSignal: AbortSignal.timeout(SAVE_RETRY_TIMEOUT_MS),
    });
    messages.push(...((res?.response?.messages ?? []) as ModelMessage[]));
  } catch (err) {
    console.warn(
      `[thesis-writer] decision retry failed ticker=${T} child=${args.childRunId}:`,
      err instanceof Error ? err.message : err,
    );
  }
  return { decision: accepted as ValidatedThesisDecision | null, riskReward: acceptedRR as number | null, attempts, messages };
}

export async function writerPersistPhase(
  args: RunThesisWriterArgs,
  pullOutput: WriterPullPhaseOutput,
  research: WriterResearchPhaseOutput,
  t0: number,
): Promise<RunThesisWriterResult> {
  const T = args.ticker.toUpperCase();
  let thesisId: string | null = null;
  let persistError: string | null = research.ok ? null : research.error ?? "research failed";

  try {
    const analyst = await loadWriterAnalyst(args.analystId);

    // ── Persist the thesis through the existing Layer-1 gates ──────────
    if (research.ok && research.decision && analyst) {
      let d = research.decision;
      const sections = parseIntoSections(research.noteText);
      const sectionArgs = sectionArgsFrom(sections);
      const ctx = await buildWriterToolCtx(args, analyst);

      if (args.mode === "mint") {
        // Retry-idempotency inside the persist step: if a prior attempt of
        // THIS step already minted (step abandoned after the DB write but
        // before reporting), reuse the row instead of double-minting.
        const priorMint = await prisma.thesis.findFirst({
          where: { researchRunId: args.childRunId, ticker: T },
          select: { id: true },
          orderBy: { createdAt: "desc" },
        });
        if (priorMint) thesisId = priorMint.id;
      } else if (args.existingThesisId) {
        // Same retry-idempotency for refresh: a prior attempt's audit row
        // means the update already landed — don't write it twice.
        const priorTouch = await prisma.thesisUpdate.findFirst({
          where: { runId: args.childRunId, thesisId: args.existingThesisId },
          select: { thesisId: true },
        });
        if (priorTouch) thesisId = priorTouch.thesisId;
      }

      const existing =
        args.mode === "refresh" && args.existingThesisId
          ? await loadExistingThesis(args.existingThesisId)
          : null;

      const saveOnce = async (decision: ValidatedThesisDecision): Promise<WriterSaveOutcome> => {
        const call = buildWriterSaveCall(
          args,
          pullOutput.pull,
          decision,
          sectionArgs,
          existing ? { direction: existing.direction, status: existing.status } : null,
        );
        const toolInstance = call.toolName === "record_thesis" ? recordThesis(ctx) : updateThesis(ctx);
        const outcome = readWriterSaveResult(call.toolName, await executeThroughSchema(toolInstance, call.toolName, call.toolArgs));
        if (call.toolName === "update_thesis" && !outcome.error && args.existingThesisId) {
          // The audit row is the proof — a missing row means nothing was
          // saved, whatever the envelope said. Never default to the existing
          // id here (ABT 2026-09-08, DAV-231).
          const touch = await prisma.thesisUpdate.findFirst({
            where: { runId: args.childRunId, thesisId: args.existingThesisId },
            select: { thesisId: true },
          });
          return touch
            ? { ...outcome, thesisId: touch.thesisId }
            : { ...outcome, error: `update_thesis returned ok but wrote no audit row for ${args.existingThesisId} — nothing was saved`, fixable: false };
        }
        return outcome;
      };

      const canSave = args.mode === "mint" || !!args.existingThesisId;
      if (thesisId === null && canSave) {
        let outcome = await saveOnce(d);

        // ── One retry: hand the refusal back to the model ───────────────
        if (!outcome.thesisId && outcome.fixable && outcome.error) {
          await writePhaseEvent(
            args.childRunId,
            "Save refused — retrying once",
            outcome.error,
            { ticker: T, mode: args.mode },
          );
          const retried = await resubmitWithFeedback({
            args,
            pullOutput,
            systemPrompt: research.systemPrompt,
            userPrompt: research.userPrompt,
            noteText: research.noteText,
            analyst,
            existing,
            ctx,
            previous: d,
            feedback: `The save refused it: ${outcome.error}`,
          });
          if (retried.decision) {
            d = retried.decision;
            outcome = await saveOnce(d);
          }
        }
        thesisId = outcome.thesisId;
        persistError = outcome.thesisId ? null : outcome.error ?? "unknown";
      }

      await writePhaseEvent(
        args.childRunId,
        thesisId ? "Thesis persisted" : "Persist refused",
        thesisId
          ? `${args.mode === "mint" ? "record_thesis" : "update_thesis"} landed (${d.direction}${d.conviction ? `, ${d.conviction}` : ""}${research.riskReward ? `, R/R ${research.riskReward.toFixed(2)}:1` : ""}).`
          : persistError ?? "unknown",
        { ticker: T, thesisId, mode: args.mode },
      );
    }
  } catch (err) {
    persistError = err instanceof Error ? err.message : String(err);
    console.error(
      `[thesis-writer] persist phase failed ticker=${T} child=${args.childRunId}: ${persistError}`,
    );
  }

  // ── Finalize — runs on EVERY outcome ─────────────────────────────────
  const elapsed = Date.now() - t0;
  const finalStatus: "COMPLETE" | "FAILED" = thesisId !== null ? "COMPLETE" : "FAILED";

  // 1. Replay thread — persisted success or fail. A timed-out V1 run left
  //    no RunMessage at all; that observability hole is the reason CEG/CRWD
  //    took a diagnosis agent to reconstruct.
  try {
    if (research.userPrompt || research.threadMessages.length > 0) {
      const threadContent = JSON.stringify([
        { role: "user", content: research.userPrompt || `Write a deep-research thesis on $${T} (${args.mode}).` },
        ...research.threadMessages,
      ]);
      await prisma.$transaction([
        prisma.runMessage.deleteMany({ where: { runId: args.childRunId } }),
        prisma.runMessage.create({
          data: { runId: args.childRunId, role: "thread", content: threadContent },
        }),
      ]);
    }
  } catch (msgErr) {
    console.warn(
      `[thesis-writer] thread persistence failed for child=${args.childRunId}:`,
      msgErr instanceof Error ? msgErr.message : msgErr,
    );
  }

  // 2. Terminal status — atomic RUNNING → terminal. Status is derived
  //    SOLELY from whether a thesis row landed; nothing else can stamp
  //    COMPLETE on a run that wrote nothing.
  try {
    await prisma.researchRun.updateMany({
      where: { id: args.childRunId, status: "RUNNING" },
      data: { status: finalStatus, completedAt: new Date() },
    });
  } catch (statusErr) {
    console.error(
      `[thesis-writer] terminal status write failed for child=${args.childRunId}:`,
      statusErr instanceof Error ? statusErr.message : statusErr,
    );
  }

  // 3. Parameters enrichment (best-effort).
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
          writerVersion: 2,
          agentSteps: research.stepCount,
          agentToolCalls: research.toolCallCount,
          elapsedMs: elapsed,
          thesisId,
          sectionCount: research.sectionCount,
          submitAttempts: research.submitAttempts,
          pullErrors: pullOutput.pull?.pullErrors ?? [],
          riskReward: research.riskReward,
          ...(finalStatus === "FAILED"
            ? { error: persistError ?? research.error ?? "unknown", failedAt: new Date().toISOString() }
            : {}),
        } as object,
      },
    });
  } catch (statsErr) {
    console.warn(
      `[thesis-writer] failed to persist run parameters for child=${args.childRunId}:`,
      statsErr instanceof Error ? statsErr.message : statsErr,
    );
  }

  // 4. Failure event (RunCard-compatible shape) — and the ledger row. The
  //    writer's own refusals (DYN, IBRX, BBIO on 09-25) never reached the
  //    refusal ledger, so the Activity feed and the next run never heard
  //    of them. A writer that ends with no thesis is a refused thesis save:
  //    open until a save lands on the ticker for this analyst.
  if (finalStatus === "FAILED") {
    try {
      await prisma.gateRejection.create({
        data: {
          tool: "thesis_writer",
          gateCode: "writer_failed",
          summary: `Thesis research on $${T} produced no thesis (${args.mode})`,
          detail: (persistError ?? research.error ?? "unknown").slice(0, 2000),
          ticker: T,
          thesisId: args.existingThesisId ?? null,
          runId: args.childRunId,
          analystId: args.analystId,
          runMode: "THESIS_WRITER",
          resolvedAt: null,
          resolvedBy: null,
        },
      });
    } catch {
      /* the ledger is telemetry — never fails the writer */
    }
    try {
      await prisma.runEvent.create({
        data: {
          runId: args.childRunId,
          type: "run_failed",
          title: "Thesis-writer did not produce a thesis",
          message: persistError ?? research.error ?? "unknown",
          payload: {
            ticker: T,
            mode: args.mode,
            steps: research.stepCount,
            toolCalls: research.toolCallCount,
          } as object,
        },
      });
    } catch {
      /* best-effort */
    }
  }

  return {
    childRunId: args.childRunId,
    status: finalStatus,
    thesisId,
    steps: research.stepCount,
    toolCalls: research.toolCallCount,
    elapsedMs: elapsed,
    ...(finalStatus === "FAILED"
      ? { error: persistError ?? research.error ?? "unknown" }
      : {}),
  };
}

// ── Orchestrator (direct-call path: backfill script, tests) ─────────────

export async function runThesisWriterAgent(
  args: RunThesisWriterArgs,
): Promise<RunThesisWriterResult> {
  const t0 = Date.now();

  const idempotent = await writerIdempotencyCheck(args);
  if (idempotent) return { ...idempotent, elapsedMs: Date.now() - t0 };

  const pullOutput = await writerPullPhase(args);
  const research = await writerResearchPhase(args, pullOutput);
  return writerPersistPhase(args, pullOutput, research, t0);
}
