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
import { getMoneyContext } from "@/lib/agent/context-bundle";
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
import { updateThesis } from "@/lib/agent/tools/update-thesis";

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
  analystPrompt: string | null;
  sectors: string[];
  industries: string[];
  themes: string[];
  exclusionList: string[];
  minConfidence: number;
  tradingEnvironment: string | null;
  minPositionSize: unknown;
  maxPositionSize: unknown;
  realMaxPosition: unknown;
}

async function loadWriterAnalyst(analystId: string): Promise<WriterAnalyst | null> {
  const analyst = await prisma.agentConfig.findUnique({
    where: { id: analystId },
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
      tradingEnvironment: true,
      // DAV-204: the writer authors target_size_pct — it must see the money.
      minPositionSize: true,
      maxPositionSize: true,
      realMaxPosition: true,
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
  hasTriggers: boolean;
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
    hasTriggers: Array.isArray(row.triggers) && row.triggers.length > 0,
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
  // DAV-204: sizing fields + alpaca creds so record_thesis's sub-floor gate
  // (#524) actually runs on the writer's persist path — without these the
  // gate silently skipped, and the 2026-08-19 mint batch authored five
  // sub-floor (un-fillable) plans that needed a manual heal.
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
    realMaxPosition: Number(analyst.realMaxPosition),
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
  /** DAV-204: the analyst's real position band + live equity when known. */
  sizing?: {
    floorDollars: number;
    ceilingDollars: number;
    equityUSD: number | null;
  } | null;
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
  • Simplest correct move: OMIT the triggers field and the existing
    ladder stays untouched; pass a full ladder only when the refresh
    genuinely re-plans it (triggers are wholesale-REPLACE).`
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
  • Breakout setup → ENTER on PRICE_ABOVE(entry_price) (mirror for SHORT).
  • Buy-now-at-market intent → set entry_price = current price, omit the
    ENTER trigger, and express urgency via conviction (STRONG + variant
    view). Triggers are the WHEN; conviction is the WITH WHAT INTENSITY.
  • Most theses need NO custom triggers — omit the field and the
    horizon-default template (entry/stop/review) is applied for you.`;

  // DAV-204 — state the floor as a PERCENT of live equity so "4% feels
  // right" can't author a plan place_trade will refuse.
  const sizingBlock =
    opts.sizing && opts.sizing.floorDollars > 0
      ? `
POSITION SIZING — REAL MONEY CONSTRAINTS (this analyst's band)
  • Per-entry band: $${Math.round(opts.sizing.floorDollars).toLocaleString()} floor to $${Math.round(opts.sizing.ceilingDollars).toLocaleString()} ceiling. place_trade REJECTS entries outside it — a sub-floor target_size_pct is an un-fillable plan (the RARE failure: the ENTER fires and dies on the analyst's own sizing).
${
  opts.sizing.equityUSD
    ? `  • Account equity ≈ $${Math.round(opts.sizing.equityUSD).toLocaleString()} → target_size_pct must be ≥ ${Math.ceil((opts.sizing.floorDollars / opts.sizing.equityUSD) * 1000) / 10}% to clear the floor. submit_thesis validates this.`
    : `  • Live equity unavailable this run — err toward the tier's upper bound rather than under-sizing.`
}
  • If conviction doesn't justify a full-floor position, that is a PASS, not a small size.
`
      : "";

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

  return `You are ${opts.analystName}, writing one deep-research thesis on $${T}.

${opts.analystPrompt ? `Your strategy:\n${opts.analystPrompt}\n` : ""}
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
   One paragraph — insider activity (names if available) + chart setup
   (levels, RSI, trend).

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
   • entry_price is WHERE YOU'D BUY IN (breakout level, or current price
     for buy-now setups) — it drives the default ENTER trigger. Not a
     price snapshot.
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
   • target_size_pct pairs with tier: STRONG 4-6, HIGH 3-5, MEDIUM 2-3,
     LOW 1-2.
   • confidence context: this analyst's minimum confidence for
     trade-eligible coverage is ${opts.minConfidence}/100 — calibrate composite +
     conviction honestly against that bar.

${triggerBlock}
${sizingBlock}${priorExitBlock}
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
      `7 parallel pulls${pull.pullErrors.length ? ` — ${pull.pullErrors.length} failed: ${pull.pullErrors.join(", ")}` : " — all sources ok"}. Live price: ${pull.currentPrice ?? "unavailable"}.`,
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

    // ── DAV-204: money context ──────────────────────────────────────────
    // The writer authors target_size_pct but never saw equity or the
    // analyst's position band — it sized by conviction habit (2.5-4%) and
    // the 2026-08-19 batch minted five sub-floor, un-fillable plans.
    // Sourced from the shared context bundle (System 1, THREE_SYSTEMS.md
    // Move 1) so the writer, discovery, and future paths quote one reality.
    const runEnvironment = (analyst.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
    const money = await getMoneyContext(analyst);
    const floorDollars = money.floorDollars;
    const equityUSD = money.equityUSD;

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
      sizing:
        floorDollars > 0
          ? {
              floorDollars,
              // positionBand-resolved (LIVE: min(max, promotion cap)) so the
              // prompt quotes the ceiling place_trade actually enforces.
              ceilingDollars: money.ceilingDollars ?? (Number(analyst.maxPositionSize) || 0),
              equityUSD,
            }
          : null,
      priorExit,
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

    const submitThesisTool = tool({
      description:
        "Submit your final thesis decision. Call ONCE after the research note is fully written. " +
        "If the result lists validation errors, fix exactly those fields and call again.",
      inputSchema: thesisDecisionSchema,
      execute: async (raw: z.infer<typeof thesisDecisionSchema>) => {
        submitAttempts++;
        const v = validateThesisDecision(raw, {
          mode: args.mode,
          existingStatus: existingThesis?.status ?? null,
          currentPrice,
          // Persist-gate mirrors (goalpost + zero-trigger) need the
          // existing row's shape — see decision.ts review-finding-#4 block.
          existingTargetPrice: existingThesis?.targetPrice ?? null,
          existingHasTriggers: existingThesis?.hasTriggers,
          // DAV-204 sub-floor mirror + P1-35 prior-exit acknowledgment.
          equityUSD,
          minPositionSize: floorDollars,
          maxPositionSize: Number(analyst.maxPositionSize) || undefined,
          realMaxPosition: Number(analyst.realMaxPosition) || undefined,
          environment: runEnvironment,
          priorExit,
        });
        if (!v.ok) {
          console.log(
            `[thesis-writer] submit_thesis attempt ${submitAttempts} rejected ticker=${T}: ${v.errors.length} error(s)`,
          );
          return {
            accepted: false,
            errors: v.errors,
            instruction:
              "Fix exactly these fields and call submit_thesis again. Do NOT rewrite the research note.",
          };
        }
        accepted = v.decision!;
        acceptedRR = v.riskReward ?? null;
        return {
          accepted: true,
          instruction: "Decision accepted and recorded. STOP — do not write anything further.",
        };
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            web_search: anthropic.tools.webSearch_20260209({ maxUses: WEB_SEARCH_MAX_USES }) as any,
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
  ok?: boolean;
  data?: Record<string, unknown>;
  summary?: string;
}

/**
 * Run server-built args through the tool's OWN input schema, then execute.
 * Direct .execute() calls bypass the AI SDK's Zod validation layer, which
 * is where .default() values (source_signal_ids: [], trigger ids/fireMode)
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
      const d = research.decision;
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
        if (priorMint) {
          thesisId = priorMint.id;
        }
      }

      if (args.mode === "mint" && thesisId === null) {
        const toolArgs: Record<string, unknown> = {
          ticker: T,
          company_name: pullOutput.pull?.companyName ?? undefined,
          exchange: pullOutput.pull?.exchange ?? undefined,
          direction: d.direction,
          // Writer mints are always entry-gated coverage; PASS derives its
          // own terminal state inside record_thesis.
          status: d.direction === "PASS" ? undefined : "WATCHING",
          reasoning_summary: d.rationale,
          entry_price: d.entry_price,
          target_price: d.target_price,
          stop_loss: d.stop_loss,
          horizon: d.horizon,
          catalyst_date: d.catalyst_date
            ? new Date(d.catalyst_date).toISOString()
            : undefined,
          max_hold_days: d.max_hold_days,
          scoring: d.scoring,
          conviction: d.conviction,
          conviction_rationale: d.conviction_rationale,
          variant_view: d.variant_view,
          target_size_pct: d.target_size_pct,
          core_belief: d.core_belief,
          key_assumptions: d.key_assumptions,
          invalidation_conditions: d.invalidation_conditions,
          // PASS theses cannot carry triggers (record_thesis gate) — the
          // validator rejects this too; strip defensively.
          triggers: d.direction === "PASS" ? undefined : d.triggers,
          // P1-35: pass the model's engagement with a recent sale through
          // to record_thesis's recently-sold gate.
          acknowledge_prior_exit: d.prior_exit_acknowledgment,
          source_kind: "WEB_SEARCH",
          source_rationale: args.reason.slice(0, 300),
          research_data: pullOutput.pull?.rawDataBlock,
          ...sectionArgs,
        };
        const res = await executeThroughSchema(recordThesis(ctx), "record_thesis", toolArgs);
        if ("__schemaError" in res) {
          persistError = res.__schemaError;
        } else {
          const data = res?.data ?? {};
          if (typeof data.thesis_id === "string" && data.thesis_id) {
            thesisId = data.thesis_id;
          } else {
            persistError = `record_thesis refused: ${String(data.note ?? data.error ?? res?.summary ?? "unknown")}`;
          }
        }
      } else if (args.existingThesisId) {
        // Same retry-idempotency for refresh: a prior attempt's audit row
        // means the update already landed — don't write it twice.
        const priorTouch = await prisma.thesisUpdate.findFirst({
          where: { runId: args.childRunId, thesisId: args.existingThesisId },
          select: { thesisId: true },
        });
        if (priorTouch) {
          thesisId = priorTouch.thesisId;
        }
      }

      if (args.mode === "refresh" && args.existingThesisId && thesisId === null) {
        const existing = await loadExistingThesis(args.existingThesisId);
        // Role split (docs/THESIS_ARCHITECTURE.md §0): the writer refreshes
        // research; it NEVER changes direction or status. A changed view is
        // flagged in the rationale for the orchestrator to act on.
        const directionFlag =
          existing?.direction && d.direction !== existing.direction
            ? ` ⚠ Writer's refreshed view is ${d.direction} vs stored ${existing.direction} — orchestrator should re-evaluate direction.`
            : "";
        const toolArgs: Record<string, unknown> = {
          thesis_id: args.existingThesisId,
          rationale: `${d.rationale}${directionFlag}`,
          // Always supplied: the P0-1 gate refuses price moves when the
          // belief text happens to be unchanged; the writer's judgment on
          // why lives in the decision rationale.
          structural_unchanged_reason: d.rationale,
          entry_price: d.direction === "PASS" ? undefined : d.entry_price,
          target_price: d.direction === "PASS" ? undefined : d.target_price,
          stop_loss: d.direction === "PASS" ? undefined : d.stop_loss,
          horizon: d.horizon,
          catalyst_date: d.catalyst_date
            ? new Date(d.catalyst_date).toISOString()
            : undefined,
          max_hold_days: d.max_hold_days,
          scoring: d.scoring,
          conviction: d.conviction,
          conviction_rationale: d.conviction_rationale,
          variant_view: d.variant_view,
          target_size_pct: d.target_size_pct,
          core_belief: d.core_belief,
          key_assumptions: d.key_assumptions,
          invalidation_conditions: d.invalidation_conditions,
          triggers: d.triggers,
          price_at_time: pullOutput.pull?.currentPrice ?? undefined,
          research_data: pullOutput.pull?.rawDataBlock,
          ...sectionArgs,
        };
        const res = await executeThroughSchema(updateThesis(ctx), "update_thesis", toolArgs);
        if ("__schemaError" in res) {
          persistError = res.__schemaError;
        } else {
          const data = res?.data ?? {};
          if (data.ok === false) {
            persistError = `update_thesis refused: ${String(data.message ?? data.error ?? res?.summary ?? "unknown")}`;
          } else {
            // Confirm via the audit row — same source of truth V1 used.
            const touch = await prisma.thesisUpdate.findFirst({
              where: { runId: args.childRunId, thesisId: args.existingThesisId },
              select: { thesisId: true },
            });
            thesisId = touch?.thesisId ?? args.existingThesisId;
          }
        }
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

  // 4. Failure event (RunCard-compatible shape).
  if (finalStatus === "FAILED") {
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
