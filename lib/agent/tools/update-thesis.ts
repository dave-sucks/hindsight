/**
 * update_thesis — patch a durable thesis without rewriting it.
 *
 * Replaces the old "rewrite the whole thesis on every touch" pattern.
 * Each call:
 *   1. Loads the current Thesis row (by id, scoped to this analyst).
 *   2. Applies the patch — only the fields the agent passes are changed.
 *   3. Computes a structured diff and writes ONE ThesisUpdate row with the
 *      diff, rationale, signals cited, and price/position context at the
 *      moment of the update.
 *
 * Design notes:
 * - Updates do NOT chain via parentThesisId. The activity log IS the chain.
 *   parentThesisId is reserved for genuine thesis replacements via
 *   record_thesis (when direction or core belief shifts so significantly
 *   the agent wants a clean break).
 * - Status transitions go through a separate `change_status` field. We
 *   don't allow agents to silently flip ACTIVE → INVALIDATED via this tool;
 *   that's a deliberate transition with its own ThesisUpdate type.
 * - Triggers change one at a time (DAV-242): `add_triggers`, `edit_triggers`
 *   by id, `remove_trigger_ids`, and the entry / target / stop arguments are
 *   the same ops on the buy / target / floor trigger. Every op is its own
 *   line in the activity log; a refused op is reported by id and the rest
 *   of the call lands. See lib/agent/triggers/ops.ts.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { TRIGGER_EDITS, thesisFields } from "@/lib/agent/tools/thesis-fields";
import { prisma } from "@/lib/prisma";
import {
  parseTriggersResilient,
  triggersInputArraySchema,
  editTriggerOpSchema,
  editNumber,
} from "@/lib/agent/triggers/schema";
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { ResolvedTrigger } from "@/lib/agent/triggers/levels";
import { getSetup, isNamedSetup } from "@/lib/agent/knowledge/setups";
import { loadSetupOverrides } from "@/lib/agent/knowledge/load-setup-overrides";
import { heldSetupExitOps } from "@/lib/agent/triggers/setup-exits";
import { freshQuotePrice } from "@/lib/market-data/quote-age";
import {
  acceptedOps,
  applyTriggerOps,
  checkLadder,
  describeTrigger,
  type TriggerOp,
  type TriggerOpResult,
} from "@/lib/agent/triggers/ops";
import {
  declinedSaleWhere,
  declinedSaleWork,
  foldDeclines,
} from "@/lib/agent/declined-sale";
import { thesisFloorStop } from "@/lib/agent/triggers/floor-in-force";
import { isPlanLevelOnList } from "@/lib/agent/triggers/price-levels";
import {
  writeThesisUpdate,
  diffThesisFields,
  compactFieldChanges,
  type ThesisUpdateType,
} from "@/lib/agent/thesis-updates";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import { isUnresearchedSeed } from "@/lib/agent/thesis-direction";
import {
  checkStatusTransition,
  checkTerminateWithoutClose,
  checkWatchingOptOut,
  needsPairedCloseCheck,
} from "@/lib/agent/thesis-transitions";
import { holdDurationFromHorizon } from "@/lib/agent/horizon-policy";
import { computePlanSanity } from "@/lib/agent/plan-sanity";
import { getThesisComposite } from "@/lib/agent/thesis-narrative";

// The fields update_thesis shares with record_thesis and submit_thesis are defined once (thesis-fields.ts).
const F = thesisFields();

const updateSchema = z.object({
  thesis_id: z.string().describe("Thesis id to update."),
  rationale: z
    .string()
    .min(10)
    .describe(
      "Required. What you did on this stock and why: every update writes one Activity line, and the newest one heads the stock's page. When you move a level and the belief still holds, say why in one sentence here. Shown to the owner on the stock's Activity and at the top of the stock's page; write it by How you write.",
    ),
  trigger_id: z
    .string()
    .optional()
    .describe(
      "If this update was prompted by a trigger firing, the id of that trigger. Optional.",
    ),
  price_at_time: F.live_price.optional(),
  core_belief: F.core_belief.optional(),
  key_assumptions: F.key_assumptions.optional(),
  invalidation_conditions: F.invalidation_conditions.optional(),
  scoring: F.scoring_patch.optional(),
  target_price: F.target_price.nullable().optional(),
  stop_loss: F.stop_loss.nullable().optional(),
  setup_id: F.setup_id_or_none.optional(),
  stop_basis: F.stop_basis.optional(),
  target_basis: F.target_basis.optional(),
  entry_on_close: F.entry_on_close.optional(),
  entry_price: F.entry_price.nullable().optional(),
  conviction: F.conviction.optional(),
  conviction_rationale: F.conviction_rationale.optional(),
  variant_view: F.variant_view.optional(),
  direction: F.direction.optional(),
  horizon: F.horizon.optional(),
  catalyst_date: F.catalyst_date.nullable().optional(),

  // ── Trigger ops (DAV-242) — one trigger at a time, never a whole list ──
  add_triggers: triggersInputArraySchema.optional().describe(TRIGGER_EDITS.add),
  edit_triggers: z.array(editTriggerOpSchema).optional().describe(TRIGGER_EDITS.edit),
  remove_trigger_ids: z.array(z.string()).optional().describe(TRIGGER_EDITS.remove),
  snapshot: F.snapshot.optional(),
  recent_catalysts: F.recent_catalysts.optional(),
  fundamentals: F.fundamentals.optional(),
  latest_earnings: F.latest_earnings.optional(),
  catalysts_and_events: F.catalysts_and_events.optional(),
  bull_case: F.bull_case.optional(),
  bear_case: F.bear_case.optional(),
  analyst_consensus: F.analyst_consensus.optional(),
  insider_technical: F.insider_technical.optional(),

  // ── Status transitions (deliberate) ───────────────────────────────────
  // PROMOTED is intentionally excluded — only the promote-analyst action
  // sets it. Setting it here will fail Zod parse before this runs.
  change_status: z
    // P1-24 contract: the tool-owned account facts (HOLDING on a buy fill,
    // RETIRED-SOLD on a sell fill) are no longer accepted here — they were
    // the legacy ACTIVE/CLOSED verbs, removed from this enum. The agent still
    // speaks INVALIDATED / ARCHIVED as its intent verbs; the handler
    // translates them to the stored status=RETIRED + a retiredReason
    // (INVALIDATED → reason INVALIDATED, ARCHIVED → reason DROPPED).
    .enum(["INVALIDATED", "ARCHIVED", "WATCHING"])
    .optional()
    .describe(
      "INVALIDATED = the belief broke on evidence; the thesis retires (reason INVALIDATED). " +
        "ARCHIVED = drop the stock for good; it retires (reason DROPPED). To stop paying for a stock or shelve a plan, keep it WATCHING and remove its buy, floor and target by id instead. " +
        "WATCHING = put a stock you sold back on watch (or opt out of re-entering a promoted one). " +
        "Holding and sold are not set here: place_trade and close_position flip them when the order fills. A researched decline is direction: \"PASS\".",
    ),
  research_data: F.research_data.optional(),
});

type UpdatePatch = Partial<{
  setupId: string | null;
  // P1-24: `LONG | SHORT | null` only. A PASS patch writes `null` here and
  // carries the pass fact on status=PASSED (the column no longer stores
  // 'PASS' or 'PENDING').
  direction: string | null;
  entryPrice: number | null;
  // PR-9 flat schema: legacy plain-string columns (reasoningSummary,
  // thesisBullets, riskFlags) replaced by JSONB section columns. Per the
  // single-shot cutover, the writer no longer surfaces the old fields.
  snapshot: object;
  bullCase: object;
  bearCase: object;
  recentCatalysts: object;
  fundamentals: object;
  latestEarnings: object;
  catalystsAndEvents: object;
  analystConsensus: object;
  insiderTechnical: object;
  researchUpdatedAt: Date;
  coreBelief: string | null;
  keyAssumptions: string[];
  invalidationConds: string[];
  // PR-9 dropped confidenceScore / signalTypes columns. Conviction lives
  // in scoring.composite (set via the scoring arg, not patched directly).
  scoring: object;
  targetPrice: number | null;
  stopLoss: number | null;
  // ── Conviction Expression v4 (existing-row read) ──────────────────────
  conviction: string | null;
  convictionRationale: string | null;
  variantView: string | null;
  horizon: string | null;
  catalystDate: Date | null;
  lastReviewedAt: Date | null;
  triggers: object;
  status: string;
  retiredReason: string | null;
  invalidatedAt: Date;
  invalidReason: string;
  closedAt: Date | null;
  closeReason: string | null;
  promotedAt: Date | null;
  // THESIS_RESEARCH_V2 Phase 1 — refresh path persistence.
  // PR-9: researchSections blob dropped; researchUpdatedAt is declared
  // higher up in this same type (stamped when any V2 section lands).
  researchData: string;
}>;

/**
 * A refused call writes nothing, so no trigger change landed — every op says
 * so. Returning the per-op results unchanged told the VST analyst "Removed:
 * buy above $165, ok" on a refused call; it believed the buy was gone, removed
 * the floor and target instead, and left the buy it meant to delete (DAV-258).
 */
export function notApplied(results: TriggerOpResult[], error: string): TriggerOpResult[] {
  const reason = `Not applied — the whole update was refused (${error}).`;
  return results.map((r) => (r.ok ? { ...r, ok: false, reason } : r));
}

/**
 * The exact call that sets a plan down. VST 09-11: the analyst removed only
 * the buy, the half-plan rule refused it, and the message said "remove the
 * floor and target triggers" without saying which — so it guessed. Every plan
 * level on the stored list, by id, removed together, is a call that lands.
 */
export function setDownInstruction(stored: Trigger[], direction: string | null): string {
  // A wake (a review with no buy behind it) is not part of a plan to set down.
  const levels = stored.filter((t) => isPlanLevelOnList(t, stored, direction));
  if (levels.length === 0) return "";
  const ids = levels.map((t) => `"${t.id}"`).join(", ");
  const words = levels.map((t) => describeTrigger(t, false)).join(", ");
  return `To set the plan down, remove all of them in one call: remove_trigger_ids: [${ids}] (${words}).`;
}

/**
 * What a check-only call (`ctx.dryRun`) returns when the save would land.
 * Carries the per-op results, refusals included: a save lands the rest of
 * the call when one trigger edit is refused, so "it saved" alone would hide
 * an edit the writer meant to make. The writer's check reads these.
 */
function dryRunPassed(ticker: string, triggerOps: TriggerOpResult[]) {
  return {
    summary: `Check only: the update on $${ticker} would save.`,
    data: { ok: true, dry_run: true, trigger_ops: triggerOps },
    sources: [],
  };
}

/**
 * The research sections only the writer's refresh fills (step 5 of
 * docs/plans/AGENT_ARCHITECTURE.md): of 370 update_thesis calls by agents in
 * the 30 days to 2026-10-05, none sent one. They leave every agent's copy of
 * the tool (4,725 characters each); the writer's refresh keeps them.
 */
const WRITER_ONLY_UPDATE_FIELDS = {
  bull_case: true,
  bear_case: true,
  recent_catalysts: true,
  fundamentals: true,
  latest_earnings: true,
  catalysts_and_events: true,
  analyst_consensus: true,
  insider_technical: true,
  research_data: true,
} as const;

/**
 * Fields the trigger run never writes: in its 72 update_thesis calls in the
 * 30 days to 2026-10-06 none sent one, and its text asks only for the belief,
 * the levels and the triggers. Conviction, the variant view and the setup are
 * the writer's and the morning run's.
 */
const NOT_THE_TRIGGER_RUNS = { conviction: true, conviction_rationale: true, variant_view: true, setup_id: true } as const;

/** The chat never answers a fired trigger, so it has no trigger to name (0 of its 58 calls in the same 30 days). */
const NOT_THE_CHATS = { trigger_id: true } as const;

export const updateThesis = defineTool({
  description:
    "Change a thesis you already have. Pass thesis_id, the fields that change and a rationale; every call writes one line to the stock's Activity. " +
    "entry_price, target_price and stop_loss are the levels of the buy, target and floor triggers, and null removes one. " +
    "Each trigger edit comes back in `trigger_ops`, accepted or refused with the reason; a refused one leaves the rest of the call in place. " +
    "On a stock we hold, only the principal moves a safety line down: if you think one is wrong, keep it and give the number you'd suggest in the rationale.",
  schema: updateSchema,
  schemaFor: (ctx) =>
    ctx.runMode === "THESIS_WRITER"
      ? updateSchema
      : ctx.runMode === "INTRADAY_TACTICAL"
        ? updateSchema.omit({ ...WRITER_ONLY_UPDATE_FIELDS, ...NOT_THE_TRIGGER_RUNS })
        : ctx.runMode === "PRINCIPAL_CHAT"
          ? updateSchema.omit({ ...WRITER_ONLY_UPDATE_FIELDS, ...NOT_THE_CHATS })
          : updateSchema.omit(WRITER_ONLY_UPDATE_FIELDS),
  ui: "thesis-card" as const,
  gateLog: "update_thesis",

  progressLabel: (args) => {
    if (args.change_status === "INVALIDATED") return `Invalidating thesis ${args.thesis_id.slice(-8)}`;
    if (args.change_status === "ARCHIVED") return `Archiving thesis ${args.thesis_id.slice(-8)}`;
    return `Updating thesis ${args.thesis_id.slice(-8)}`;
  },

  execute: async (args, ctx) => {
    // Resolve priceAtTime defensively. The agent SHOULD pass price_at_time
    // (it just called get_stock_data on this ticker). When it forgets, we
    // fall back to a fresh live quote so the timeline row never has a
    // null price for an active update. Cheap (one HTTP call, 30s cache);
    // worth it for the timeline integrity.
    let resolvedPriceAtTime: number | null = args.price_at_time ?? null;

    // Load + scope check. A thesis must belong to an analyst's user;
    // updating someone else's thesis would be a security hole.
    const existing = await prisma.thesis.findUnique({
      where: { id: args.thesis_id },
      select: {
        id: true,
        userId: true,
        ticker: true,
        status: true,
        // Diffed by the fieldChanges builder — a terminal transition writes
        // retiredReason, and the audit row should carry the from/to.
        retiredReason: true,
        // Diffed (compacted) so a degraded research_data-only refresh still
        // records that the research payload changed.
        researchData: true,
        // direction + entryPrice are read by the shape gate below — adding
        // them to the select fixes a latent bug where existing.direction
        // and existing.entryPrice came back undefined at runtime.
        direction: true,
        entryPrice: true,
        researchRun: { select: { agentConfigId: true } },
        // PR-9 flat schema: select the V2 narrative columns + scoring.
        snapshot: true,
        bullCase: true,
        bearCase: true,
        recentCatalysts: true,
        fundamentals: true,
        latestEarnings: true,
        catalystsAndEvents: true,
        analystConsensus: true,
        insiderTechnical: true,
        coreBelief: true,
        keyAssumptions: true,
        invalidationConds: true,
        scoring: true,
        targetPrice: true,
        stopLoss: true,
        // Conviction Expression v4 — read existing values so gates can
        // enforce coherence when only a subset of (conviction, rationale,
        // variantView) is being patched.
        conviction: true,
        convictionRationale: true,
        variantView: true,
        horizon: true,
        setupId: true,
        catalystDate: true,
        triggers: true,
        // Per-thesis fire state for inherited rungs — read so a rung
        // dropped as redundant can hand its cooldown stamp over.
        triggerState: true,
      },
    });

    if (!existing) {
      return {
        summary: `Thesis ${args.thesis_id} not found.`,
        data: { ok: false, error: "not_found" },
        sources: [],
      };
    }
    if (existing.userId !== ctx.userId) {
      return {
        summary: `Thesis ${args.thesis_id} does not belong to this user.`,
        data: { ok: false, error: "scope_mismatch" },
        sources: [],
      };
    }

    // priceAtTime fallback: agent didn't pass one → fetch a fresh quote
    // for this ticker. Failure is non-fatal; just leaves it null.
    if (resolvedPriceAtTime == null) {
      try {
        const quote = await getStockQuote(existing.ticker);
        if (quote && Number.isFinite(quote.c) && quote.c > 0) {
          resolvedPriceAtTime = quote.c;
        }
      } catch {
        /* handled below when the call needs a price */
      }
    }
    // A buy level's SIDE (pullback below the price, breakout above it) is
    // read off the price. When this call places or moves one and there is
    // no price at all — no price_at_time, quote failed — refuse rather than
    // guess. The guess was always "breakout" (the CRM shape: "buy the
    // pullback to $203" stored as "buy above $203" against a $258 price).
    if (resolvedPriceAtTime == null) {
      const enterIds = new Set(
        (parseTriggersResilient(existing.triggers).triggers as Trigger[])
          .filter((t) => t.action === "ENTER")
          .map((t) => t.id),
      );
      const placesBuyLevel =
        args.entry_price != null ||
        (args.edit_triggers ?? []).some((e) => editNumber(e).value != null && (e.action === "ENTER" || enterIds.has(e.id)));
      if (placesBuyLevel) {
        console.warn(`[update_thesis] refused ${existing.ticker}: no live price to place the buy level`);
        return {
          summary: `No live price for ${existing.ticker} — cannot place the buy level.`,
          data: {
            ok: false,
            error: "no_live_price",
            note:
              `The quote for ${existing.ticker} failed and no price_at_time was passed, so there is no way to know whether the buy level ` +
              `is a pullback (below the price) or a breakout (above it). Retry the same call with price_at_time set to the price from get_stock_data. The side is never guessed.`,
          },
          sources: [],
        };
      }
    }
    if (
      ctx.analystId &&
      existing.researchRun?.agentConfigId &&
      existing.researchRun.agentConfigId !== ctx.analystId
    ) {
      return {
        summary: `Thesis ${args.thesis_id} belongs to a different analyst.`,
        data: { ok: false, error: "analyst_mismatch" },
        sources: [],
      };
    }

    // ── Status-transition law (DAV-210) ──────────────────────────────────
    // Terminal rows, the PROMOTED state machine, and the writer role gate —
    // one readable table in lib/agent/thesis-transitions.ts. Codes and
    // messages are byte-identical to the inline blocks this replaced; the
    // incident history (AVGO/MRVL/TSM writer flips, the CRWD/CEG burn)
    // moved with the rules.
    const transitionInput = {
      thesisId: args.thesis_id,
      ticker: existing.ticker,
      currentStatus: existing.status,
      // A sold thesis may come back to watch (DAV-240); a dropped or
      // invalidated one may not.
      retiredReason: existing.retiredReason ?? null,
      changeStatus: args.change_status,
      runMode: ctx.runMode,
    };
    {
      const violation = checkStatusTransition(transitionInput);
      if (violation) {
        return {
          summary: violation.summary,
          data: { ok: false, ...violation.data },
          sources: [],
        };
      }
    }

    // ── HOLDING / retired-sold are tool-owned (P1-25 / P1-24) ─────────────
    // The legacy ACTIVE/CLOSED change_status verbs were removed from this
    // tool's input enum: WATCHING→HOLDING and HOLDING→retired-sold are facts
    // about the Alpaca account, set ONLY by the execution/approval layer when
    // a real fill lands (place_trade inline + promoteThesisOnApproval;
    // close_position / closeThesisOnApproval). The agent that tried to set
    // them here is what stranded SNOW: on a proposal path it flipped
    // WATCHING→ACTIVE before approval, and reject/expire never reverted it →
    // orphan thesis with no position. Now Zod rejects those verbs outright at
    // parse time; the agent expresses INTENT (place_trade / close_position)
    // and the tool projects the status.

    // ── Position-thesis pairing guard ─────────────────────────────────────
    // Terminating an ACTIVE thesis without closing its position creates a
    // zombie position: the position stays OPEN but the live thesis backing
    // it is terminal. Three observed cases:
    //   - 2026-05-13 Secular Theme / GOOGL → INVALIDATED without close
    //   - 2026-05-14 Earnings Drift / TSM → INVALIDATED without close
    //   - 2026-05-14 Catalyst Event Raider / AMZN → ARCHIVED without close (F2 gap)
    //
    // Both INVALIDATED and ARCHIVED on a HOLDING-with-position are the same
    // zombie pattern. Refuse either unless a close_position fired on the
    // same ticker in this run.
    //
    // Carve-outs:
    //   - WATCHING thesis being terminated (no position by definition) — pass.
    //   - The thesis is already terminal (handled by the terminal guard above).
    // (P1-24: the legacy `change_status='CLOSED'` verb is gone — exiting a held
    // name is close_position, which flips the thesis to RETIRED-sold itself.
    // The agent can no longer retire a held name without that paired close.)
    if (needsPairedCloseCheck(transitionInput) && ctx.analystId) {
      const openPosition = await prisma.position.findFirst({
        where: {
          analystId: ctx.analystId,
          symbol: existing.ticker,
          status: "OPEN",
        },
        select: { id: true, direction: true, quantity: true },
      });
      // Did close_position fire on this ticker in THIS run? If so, the
      // pair is intact — let the terminal transition through.
      const closeInRun =
        openPosition && ctx.runId
          ? await prisma.thesisUpdate.findFirst({
              where: {
                runId: ctx.runId,
                type: "CLOSED",
                thesis: { ticker: existing.ticker },
              },
              select: { id: true },
            })
          : null;
      const violation = checkTerminateWithoutClose(transitionInput, {
        openPosition,
        closedThisRun: closeInRun != null,
      });
      if (violation) {
        return {
          summary: violation.summary,
          data: { ok: false, ...violation.data },
          sources: [],
        };
      }
    }

    // ── Unresearched-seed-must-commit guard ──────────────────────────────
    // 2026-05-14: observed the agent calling update_thesis on seed theses
    // with reasoning/bullets set but NO `direction` arg. The call succeeded
    // (patch was non-empty so the empty-patch auto-bump didn't fire), the
    // agent pushed the review clock forward 30 days, and the seed got
    // buried for a month with no commitment. F1 in the V2 prompt tells the
    // agent to commit; this gate ENFORCES it tool-side.
    //
    // Rule: any update_thesis call on an unresearched seed MUST include
    // `direction`. The seed is "awaiting first research" — there's nothing
    // to refine until the agent commits to a view. Refining the seed's
    // reasoning/bullets without committing is the wrong shape regardless
    // of how good the rationale is.
    //
    // P1-24 B4: a seed is direction=null (new) or 'PENDING' (legacy) — the
    // isUnresearchedSeed helper catches both during the dual-read window.
    //
    // DAV-209: direction-null also covers "looked, no view yet, keeping the
    // name in view." That is a finished decision, not an unresearched seed,
    // and its wake triggers must stay editable without forcing a direction
    // commitment. The derived discriminator: such a row carries ≥1
    // AGENT-authored trigger; a seed carries none (zero triggers, or only a
    // DEFAULT-source clock).
    const existingRowTriggers: Trigger[] = Array.isArray(existing.triggers)
      ? (existing.triggers as unknown as Trigger[])
      : [];
    const isSoftWatchRow =
      isUnresearchedSeed(existing.direction) &&
      existingRowTriggers.some((t) => t.source === "AGENT");
    if (
      isUnresearchedSeed(existing.direction) &&
      !isSoftWatchRow &&
      !args.direction
    ) {
      return {
        summary: `Thesis ${args.thesis_id} is an unresearched seed — update_thesis must include direction.`,
        data: {
          ok: false,
          error: "pending_update_without_direction",
          current_direction: existing.direction,
          ticker: existing.ticker,
          message:
            `$${existing.ticker} is an unresearched seed awaiting first research. update_thesis calls on seed theses MUST include \`direction\` to commit to a view. ` +
            `Three legal commitments:\n` +
            `  • \`direction: "LONG"\` + horizon + entry_price (or one buy trigger in add_triggers) + target_price + stop_loss + core_belief + key_assumptions (≥2) + invalidation_conditions (≥2) + triggers + rationale — bullish, stays WATCHING.\n` +
            `  • \`direction: "SHORT"\` + same structural fields — bearish, stays WATCHING.\n` +
            `  • \`direction: "PASS"\` + invalidation_conditions (≥1) + rationale — researched, declined. Auto-flips to PASSED.\n` +
            `Refining a PENDING's reasoning/bullets without committing direction buries it on the watchlist and surfaces it again later with no progress. That's a soft fail dressed up as a review. Decide and commit.`,
        },
        sources: [],
      };
    }

    // ── Unresearched-seed-promotion direction guard ──────────────────────
    // The only legal direction change is OUT of an unresearched seed
    // (user/builder/editor seed → agent committed to a view). Direction
    // flips on committed (LONG ↔ SHORT) theses go through record_thesis
    // with parent_thesis_id so the audit trail captures the chain.
    //
    // P1-24 B4: a seed is direction=null (new) or 'PENDING' (legacy).
    // Set when a top-tier call arrives without its variant view: the tier
    // is stored one down, with the reason next to the rationale.
    let convictionDowngradeNote: string | null = null;
    if (args.direction) {
      if (!isUnresearchedSeed(existing.direction)) {
        return {
          summary: `Thesis ${args.thesis_id} is ${existing.direction}, not an unresearched seed — direction flips go through record_thesis.`,
          data: {
            ok: false,
            error: "direction_change_only_from_pending",
            current_direction: existing.direction,
            message:
              `update_thesis can only change direction when the existing thesis is an unresearched seed (no committed direction yet — user/builder/editor watchlist add awaiting first research). ` +
              `For an actual direction flip on a committed thesis (LONG → SHORT, etc.), call record_thesis with parent_thesis_id=${args.thesis_id} — the old thesis gets SUPERSEDED, the new direction is chained for audit.`,
          },
          sources: [],
        };
      }
      // PENDING → LONG/SHORT: need full structural commitment.
      if (args.direction === "LONG" || args.direction === "SHORT") {
        const missing: string[] = [];
        if (!args.horizon) missing.push("horizon");
        if (args.target_price == null) missing.push("target_price");
        if (args.stop_loss == null) missing.push("stop_loss");
        // The buy may already be on the stock as a chart condition, or come
        // in this call as one. SMMT 2026-10-02: the buy was "closes above
        // $17.10 and above the 20-day" (an AND trigger); this rule demanded
        // entry_price anyway, the chat sent $17.10 to satisfy it, and the
        // stock got an accidental copy of the buy it already had.
        const hasBuy =
          args.entry_price != null ||
          existingRowTriggers.some((t) => t.action === "ENTER") ||
          (args.add_triggers ?? []).some((t) => t.action === "ENTER");
        if (!hasBuy) missing.push("entry_price (or one buy trigger, action ENTER, in add_triggers)");
        if (!args.core_belief || args.core_belief.trim().length === 0) missing.push("core_belief");
        if (!args.key_assumptions || args.key_assumptions.filter((s) => s.trim().length > 0).length < 2) missing.push("key_assumptions (≥2)");
        if (!args.invalidation_conditions || args.invalidation_conditions.filter((s) => s.trim().length > 0).length < 2) missing.push("invalidation_conditions (≥2)");
        // Conviction Expression v4 — PENDING promotion requires the
        // same writer-side fields record_thesis would have required.
        if (!args.conviction) missing.push("conviction (STRONG/HIGH/MEDIUM/LOW)");
        if (!args.conviction_rationale || args.conviction_rationale.trim().length === 0) missing.push("conviction_rationale");
        // A top-tier call without its variant view is stored as MEDIUM
        // with the reason — never refused (DAV-316).
        if (
          (args.conviction === "STRONG" || args.conviction === "HIGH") &&
          (!args.variant_view || args.variant_view.trim().length === 0)
        ) {
          convictionDowngradeNote = `Stored as MEDIUM: ${args.conviction} needs a variant view (consensus expects X, I think Y) and none was given.`;
        }
        if (missing.length > 0) {
          return {
            summary: `Refused PENDING→${args.direction} promotion on $${existing.ticker} — missing structural fields.`,
            data: {
              ok: false,
              error: "pending_promotion_missing_fields",
              missing,
              message:
                `Promoting a PENDING thesis to ${args.direction} is a full commitment — you need every structural field that record_thesis would have required. Missing: ${missing.join(", ")}. Supply all of them in this call and the thesis flips PENDING → ${args.direction} WATCHING in place.`,
            },
            sources: [],
          };
        }
      }
      // PENDING → PASS: need flip-criteria.
      if (args.direction === "PASS") {
        const inv = args.invalidation_conditions ?? [];
        if (inv.filter((s) => s.trim().length > 0).length < 1) {
          return {
            summary: `Refused PENDING→PASS on $${existing.ticker} — invalidation_conditions required.`,
            data: {
              ok: false,
              error: "pending_pass_missing_invalidation",
              message:
                `Flipping PENDING to PASS still needs invalidation_conditions (≥1). PASS is institutional memory; the value of that memory is what would change the verdict. Without flip-criteria a future encounter has nothing to compare against.`,
            },
            sources: [],
          };
        }
      }
    }

    // ── Conviction Expression v4 — coherence + consistency gates ────────
    // See docs/plans/CONVICTION_EXPRESSION.md §3, §3.5. Three checks fire
    // on non-PENDING-promotion paths:
    //   1. Coherence: if patching `conviction`, must also patch rationale.
    //   2. Coherence: if patching to STRONG/HIGH, variantView must exist
    //      (either patched in this call, or already on the row).
    //   3. Consistency Gate A: conviction (patched or existing) = STRONG
    //      requires effective composite ≥ 7.
    //   4. Consistency Gate B: conviction = STRONG/HIGH requires effective
    //      entryQuality.score ≥ 2.
    //
    // "Effective" = patched value if present in this call, otherwise the
    // existing-row value. This catches the asymmetric case where a writer
    // lowers composite via a scoring patch on a thesis that already has
    // conviction=STRONG (the patch would silently break the invariant).
    // P1-24 B4: seed = direction null (new) or 'PENDING' (legacy).
    const isPendingPromotionForConvictionGates = isUnresearchedSeed(
      existing.direction,
    );
    if (!isPendingPromotionForConvictionGates) {
      const effectiveConviction = args.conviction ?? existing.conviction;
      const effectiveVariantView =
        args.variant_view !== undefined
          ? args.variant_view
          : existing.variantView;

      // Coherence check 1: setting conviction requires rationale in same call.
      if (args.conviction !== undefined) {
        if (!args.conviction_rationale || args.conviction_rationale.trim().length === 0) {
          return {
            summary: `Refused update on $${existing.ticker} — patching conviction requires conviction_rationale.`,
            data: {
              ok: false,
              error: "conviction_rationale_required",
              message:
                `Whenever you patch \`conviction\`, you must also patch \`conviction_rationale\` (a sentence or two explaining the new tier). ` +
                `Carrying over the prior rationale silently when changing the tier means the rationale stops matching the tier. Decide and document.`,
            },
            sources: [],
          };
        }
      }
      // Coherence check 2: STRONG/HIGH needs a variantView, even if just
      // carried over from the existing row. Without one the tier is stored
      // as MEDIUM with the reason next to it — a detail the app can fix is
      // fixed by the app, never a refusal (DAV-316).
      if (
        (effectiveConviction === "STRONG" || effectiveConviction === "HIGH") &&
        (!effectiveVariantView || effectiveVariantView.trim().length === 0)
      ) {
        convictionDowngradeNote = `Stored as MEDIUM: ${effectiveConviction} needs a variant view (consensus expects X, I think Y) and none is on the row.`;
      }

      // Consistency gates (Gate A, Gate B) REMOVED 2026-05-31.
      // See record-thesis.ts for the rationale: conviction is the
      // writer's view, NOT a derived field from composite. Coupling them
      // made the tier "just a name on composite," which defeated the
      // point. Conviction patches now stand on their own.
    }

    // A terminal flip clears the plan, so the price-shape rules below don't
    // apply to it. (PASS on a seed is terminal too — it lands PASSED.)
    const isTerminalTransition =
      args.change_status === "INVALIDATED" ||
      args.change_status === "ARCHIVED" ||
      args.direction === "PASS";

    // ── Trigger ops (DAV-242) ────────────────────────────────────────────
    // Every trigger change is an op: add, edit by id, remove by id — and
    // the entry / target / stop arguments are the same ops on the buy /
    // target / floor trigger. Zero triggers is a legal state (DAV-209): a
    // review-only update on a bare thesis goes through untouched.
    const triggerOps: TriggerOp[] = [
      ...(args.add_triggers ?? []).map((t) => ({ op: "add" as const, trigger: t as Trigger })),
      ...(args.edit_triggers ?? []).map((e) => ({
        op: "edit" as const,
        id: e.id,
        ...editNumber(e),
        action: e.action,
        fireMode: e.fire_mode,
        rationale: e.rationale,
        cooldownDays: e.cooldown_days,
      })),
      ...(args.remove_trigger_ids ?? []).map((id) => ({ op: "remove" as const, id })),
      ...(args.entry_price !== undefined
        ? [{ op: "level" as const, slot: "ENTRY" as const, price: args.entry_price, ...(args.entry_on_close !== undefined ? { basis: args.entry_on_close ? ("close" as const) : ("intraday" as const) } : {}) }]
        : []),
      ...(args.stop_loss !== undefined ? [{ op: "level" as const, slot: "FLOOR" as const, price: args.stop_loss, rationale: args.stop_basis }] : []),
      ...(args.target_price !== undefined ? [{ op: "level" as const, slot: "TARGET" as const, price: args.target_price, rationale: args.target_basis }] : []),
    ];

    // The levels above this thesis, resolved against an EMPTY thesis array
    // so we see them unmasked by the thesis's own triggers. Lazy: this is
    // the most-called tool in the app and most calls don't touch triggers.
    let inheritedLadder: ResolvedTrigger[] = [];
    if (triggerOps.length > 0 && !isTerminalTransition) {
      const analystId = existing.researchRun?.agentConfigId ?? null;
      const levelSources = analystId
        ? (await loadLevelSources([analystId])).get(analystId)
        : undefined;
      inheritedLadder = resolveThesisLadder(
        {
          triggers: [],
          triggerState: {},
          status: existing.status,
          horizon: args.horizon ?? existing.horizon,
        },
        levelSources,
        `thesis=${args.thesis_id}`,
      );
    }

    // Build the patch. Only set keys the agent supplied — undefined ≠ null.
    const patch: UpdatePatch = {};

    // ── Narrative section reconciliation (PR-9 flat schema) ──────────────
    // V2 section args (snapshot / bull_case / bear_case) take precedence
    // over the legacy plain-string args (reasoning_summary / thesis_bullets
    // / risk_flags). Legacy values are wrapped in the new JSONB shape.
    if (args.snapshot !== undefined) {
      patch.snapshot = args.snapshot;
    }
    if (args.bull_case !== undefined) {
      patch.bullCase = args.bull_case;
    }
    if (args.bear_case !== undefined) {
      patch.bearCase = args.bear_case;
    }
    // 6 new V2 sections — no legacy fallback.
    if (args.recent_catalysts !== undefined) patch.recentCatalysts = args.recent_catalysts;
    if (args.fundamentals !== undefined) patch.fundamentals = args.fundamentals;
    if (args.latest_earnings !== undefined) patch.latestEarnings = args.latest_earnings;
    if (args.catalysts_and_events !== undefined) patch.catalystsAndEvents = args.catalysts_and_events;
    if (args.analyst_consensus !== undefined) patch.analystConsensus = args.analyst_consensus;
    if (args.insider_technical !== undefined) patch.insiderTechnical = args.insider_technical;
    // Stamp researchUpdatedAt if any V2 section was touched (drives the
    // daily-run staleness gate).
    if (
      args.snapshot !== undefined ||
      args.bull_case !== undefined ||
      args.bear_case !== undefined ||
      args.recent_catalysts !== undefined ||
      args.fundamentals !== undefined ||
      args.latest_earnings !== undefined ||
      args.catalysts_and_events !== undefined ||
      args.analyst_consensus !== undefined ||
      args.insider_technical !== undefined
    ) {
      patch.researchUpdatedAt = new Date();
    }

    if (args.core_belief !== undefined) patch.coreBelief = args.core_belief;
    if (args.key_assumptions !== undefined)
      patch.keyAssumptions = args.key_assumptions;
    if (args.invalidation_conditions !== undefined)
      patch.invalidationConds = args.invalidation_conditions;
    // PR-9: confidence_score arg dropped — composite (in scoring) is the
    // single conviction number. Scoring is merged with existing (partial
    // updates supported); composite is computed from the 4 dims.
    if (args.scoring !== undefined) {
      // Read current scoring + merge with patch.
      const currentScoring =
        existing.scoring && typeof existing.scoring === "object"
          ? (existing.scoring as Record<string, unknown>)
          : {};
      const merged = { ...currentScoring, ...args.scoring };
      const t = (merged.trendStrength as { score?: number } | undefined)?.score ?? 0;
      const r = (merged.relativeStrength as { score?: number } | undefined)?.score ?? 0;
      const e = (merged.entryQuality as { score?: number } | undefined)?.score ?? 0;
      const c = (merged.catalystFreshness as { score?: number } | undefined)?.score ?? 0;
      patch.scoring = { ...merged, composite: t + r + e + c };
    }
    // target_price / stop_loss / entry_price are NOT written here. A level
    // change is a trigger op; the columns are recomputed from the resulting
    // trigger list in the ops block below. Writing the column directly is
    // how SNOW ended up showing a $256 stop that nothing would ever have
    // sold at. See docs/plans/LEVELS_AS_TRIGGERS.md.
    // PENDING-promotion direction flip (guarded above so this only runs on
    // legal transitions). A PASS (incl. PENDING → PASS) flips status to
    // PASSED and clears triggers; PENDING → LONG/SHORT stays WATCHING with
    // the structural fields the agent supplied.
    if (args.direction !== undefined) {
      if (args.direction === "PASS") {
        // PASS = researched-and-declined → PASSED (was ARCHIVED before the
        // status-taxonomy migration; the walk-away change_status:"ARCHIVED"
        // path below is unchanged).
        //
        // P1-24 PASS-off-direction: the pass fact now lives ENTIRELY on
        // status=PASSED. `direction` is nulled — `LONG|SHORT|null` is the
        // only legal column domain. The agent still SENDS direction:"PASS"
        // (kept call signal), we just don't store it. Readers identify a
        // pass via status=PASSED (see isPassedThesis).
        patch.direction = null;
        patch.status = "PASSED";
        patch.closedAt = new Date();
        patch.closeReason = args.rationale.slice(0, 500);
        patch.triggers = [] as unknown as object;
      } else {
        // LONG / SHORT — the only other legal direction promotion (out of
        // an unresearched seed; guarded above).
        patch.direction = args.direction;
      }
    }
    // Conviction Expression v4 — persist patched conviction fields.
    // Coherence + consistency gates above already ran; values here are
    // safe to write. Empty-string for variantView is normalized to null
    // (writer way to clear an obsolete edge).
    if (args.conviction !== undefined) patch.conviction = args.conviction;
    if (args.conviction_rationale !== undefined)
      patch.convictionRationale = args.conviction_rationale;
    if (convictionDowngradeNote) {
      patch.conviction = "MEDIUM";
      patch.convictionRationale = `${args.conviction_rationale ?? existing.convictionRationale ?? ""}\n\n[${convictionDowngradeNote}]`.trim();
    }
    if (args.variant_view !== undefined)
      patch.variantView =
        args.variant_view.trim().length === 0 ? null : args.variant_view;
    if (args.horizon !== undefined) patch.horizon = args.horizon;
    if (args.setup_id !== undefined) patch.setupId = args.setup_id;
    if (args.catalyst_date !== undefined)
      patch.catalystDate = args.catalyst_date ? new Date(args.catalyst_date) : null;
    // next_review_at is gone (DAV-195 L7). Review cadence is a trigger:
    // "review every N days", counted from the last actual review, cascading
    // account -> analyst -> thesis like every other level. An agent that
    // wants this name looked at more often edits that trigger; it does not
    // type a date. Every surface derives the due date at read time (DAV-221).
    // THESIS_RESEARCH_V2 refresh-path research persistence. PR-9: the
    // `research_sections` blob is gone — parsed sections land on the 9
    // first-class JSONB columns above (which also stamp researchUpdatedAt
    // via the V2-section-supplied check). `research_data` (the raw markdown
    // structured-data block) is still passthrough-persisted here for the
    // card's data tab + audit.
    if (
      typeof args.research_data === "string" &&
      args.research_data.length > 0
    ) {
      patch.researchData = args.research_data;
      // researchUpdatedAt was already stamped above when any V2 section
      // arrived; stamp here too as a fallback when only research_data lands
      // without sections (degraded synthesis path).
      if (patch.researchUpdatedAt === undefined) {
        patch.researchUpdatedAt = new Date();
      }
    }
    // ── Apply the trigger ops ────────────────────────────────────────────
    // Rules run per op on the resulting list (one trigger per bucket, the
    // ratchet on a held stock, a rationale on an agent's level change); a
    // refused op is reported by id and the rest lands. Then ONE check on the
    // derived plan — ordering, and 2:1 on a plan we don't own — replaces the
    // argument gate and the derived-tuple gate that used to run here.
    const opResults: TriggerOpResult[] = [];
    if (triggerOps.length > 0) {
      if (isTerminalTransition) {
        opResults.push(
          ...triggerOps.map((o) => ({
            op: o.op === "level" || o.op === "replace" ? ("edit" as const) : o.op,
            id: "id" in o ? o.id : "",
            ok: false,
            text: "Trigger change",
            reason: "The thesis is being retired in this call — its triggers are cleared with it.",
          })),
        );
      } else if (parseTriggersResilient(existing.triggers).dropped > 0) {
        // A write must not "repair" a list by dropping what it can't parse —
        // that would silently delete a stop. Say so; nothing changes.
        opResults.push(
          ...triggerOps.map((o) => ({
            op: o.op === "level" || o.op === "replace" ? ("edit" as const) : o.op,
            id: "id" in o ? o.id : "",
            ok: false,
            text: "Trigger change",
            reason: `$${existing.ticker} carries a trigger that cannot be parsed — fix the stored triggers before editing them.`,
          })),
        );
      } else {
        const levelDirection = ("direction" in patch ? patch.direction : existing.direction) as string | null;
        const levelStatus = (patch.status ?? existing.status) as string | null;
        const existingTriggers = parseTriggersResilient(existing.triggers).triggers as Trigger[];
        // DAV-315: did the principal decline a protective sale on this stock
        // in the last week? If so the ratchet lets this edit move the floor
        // DOWN — the decline is the human act the one-way rule reserves that
        // to. Nothing else about the ratchet changes; see `saleDeclined` on
        // ApplyTriggerOpsInput. A lookup failure falls back to false, which
        // is the strict behaviour we have today.
        let saleDeclined: { floorPrice: number | null } | null = null;
        // No live price, no exemption. The work list errs loud when the
        // price is unknown (a missing quote is not evidence the decline was
        // answered); lowering a safety line errs strict — without a quote
        // nobody can say the price is still past the line (QB review).
        if (levelStatus === "HOLDING" && ctx.analystId && resolvedPriceAtTime != null) {
          try {
            const pos = await prisma.position.findFirst({
              where: {
                analystId: ctx.analystId,
                symbol: existing.ticker,
                status: "OPEN",
              },
              select: { id: true, avgCost: true },
              orderBy: { openedAt: "desc" },
            });
            if (pos) {
              const rows = await prisma.order.findMany({
                where: { positionId: pos.id, ...declinedSaleWhere(new Date()) },
                select: { createdAt: true, rejectionMessage: true },
              });
              // The SAME question the work list asks, including "is the
              // price still past the line". Without the breach test the
              // exemption outlived the decline by a week and a floor could
              // be lowered after the price had already recovered.
              const work = declinedSaleWork({
                status: "HOLDING",
                direction: levelDirection,
                decline: foldDeclines(rows),
                floorPrice: thesisFloorStop({
                  triggers: existingTriggers,
                  direction: levelDirection,
                  avgCost: Number(pos.avgCost) || null,
                }),
                currentPrice: resolvedPriceAtTime ?? null,
                recentLow: null,
                now: new Date(),
              });
              if (work) saleDeclined = { floorPrice: work.floorPrice };
            }
          } catch (err) {
            console.warn(
              `[update_thesis] declined-sale lookup failed for ${existing.ticker}; ratchet stays strict:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
        const applied = applyTriggerOps({
          stored: existingTriggers,
          inherited: inheritedLadder,
          ops: triggerOps,
          direction: levelDirection,
          status: levelStatus,
          actor: "AGENT",
          saleDeclined,
          // The tape decides which side a re-levelled buy trigger compares on.
          // Without it every re-level was a breakout: the CRM shape, where the
          // analyst wrote "buy the pullback to $203" and the row stored
          // "buy above $203" against a $258 tape.
          currentPrice: resolvedPriceAtTime,
          // The stamp takes only a fresh server quote — never price_at_time.
          // A check-only call throws the stamp away, so it doesn't spend a
          // quote on it: the shared key is the trigger check's first.
          writtenPrice: ctx.dryRun
            ? null
            : await getStockQuote(existing.ticker)
                .then((q) => freshQuotePrice(q, new Date()))
                .catch(() => null),
          now: new Date(),
          mintId: () => randomUUID(),
        });
        opResults.push(...applied.results);

        if (applied.results.some((r) => r.ok)) {
          // Held: the entry is the fill. The open Position's avgCost is the
          // canonical record of what we actually own at what price (the
          // 2026-05-12 AMD shape — a $420 planned entry, a $446 fill, and a
          // $434 stop refused against the plan). Fall back to the row.
          const held = levelStatus === "HOLDING";
          const openPosition =
            held && ctx.analystId
              ? await prisma.position.findFirst({
                  where: {
                    analystId: ctx.analystId,
                    symbol: existing.ticker,
                    status: "OPEN",
                  },
                  select: { avgCost: true },
                  orderBy: { openedAt: "desc" },
                })
              : null;
          const avgCost =
            openPosition?.avgCost != null ? Number(openPosition.avgCost) : null;
          const check = checkLadder({
            triggers: applied.triggers,
            inherited: inheritedLadder,
            direction: levelDirection,
            status: levelStatus,
            actor: "AGENT",
            entryPrice:
              avgCost ?? (existing.entryPrice != null ? Number(existing.entryPrice) : null),
            avgCost,
          });
          if (!check.ok) {
            return {
              summary: `Refused update on $${existing.ticker} — the resulting plan is invalid (${check.error}).`,
              data: {
                ok: false,
                error: check.error,
                // Both refusals offer "set the plan down" as an exit; name the
                // exact ids so the agent doesn't guess (DAV-258 for the half
                // plan, DAV-262 for the 2:1 floor — MSFT 2026-09-14 was told
                // to send the whole list again, an argument that no longer exists).
                message: `${check.message} ${setDownInstruction(existingTriggers, levelDirection)}`.trim(),
                trigger_ops: notApplied(opResults, check.error),
              },
              sources: [],
            };
          }

          // ── Goalpost-moving guard (audit Root Cause #3) ──────────────────
          // Raising the target on a WATCHING thesis whose price has already
          // crossed the OLD target is moving the bar instead of acting (the
          // MRVL pattern). A raise while price is still below the old target
          // is a legitimate refinement.
          if (
            levelStatus === "WATCHING" &&
            check.columns.targetPrice != null &&
            existing.targetPrice != null &&
            check.columns.targetPrice > Number(existing.targetPrice) &&
            resolvedPriceAtTime != null &&
            resolvedPriceAtTime >= Number(existing.targetPrice)
          ) {
            return {
              summary: `Refused to raise target on $${existing.ticker} — entry condition is currently met.`,
              data: {
                ok: false,
                error: "goalpost_moving_blocked",
                message:
                  `${existing.ticker} is at $${resolvedPriceAtTime.toFixed(2)} and the existing target is $${Number(existing.targetPrice).toFixed(2)}. The entry condition is MET — your action is to PROMOTE (place_trade, which flips WATCHING → HOLDING), not raise the target to $${check.columns.targetPrice.toFixed(2)} and walk away. If you genuinely think the setup has changed, leave the target untouched and give the concrete reason in your rationale (volume too low, regime change, fresh negative news, R/R no longer 2:1). Or close the thesis with change_status: "INVALIDATED".`,
                trigger_ops: notApplied(opResults, "goalpost_moving_blocked"),
              },
              sources: [],
            };
          }

          patch.triggers = applied.triggers as unknown as object;
          patch.targetPrice = check.columns.targetPrice;
          patch.stopLoss = check.columns.stopLoss;
          // entryPrice on a HELD thesis is a historical fact — what the fill
          // actually cost, written once by place_trade. On a watch row it
          // derives from the buy trigger like the others.
          if (!held) patch.entryPrice = check.columns.entryPrice;
        }
      }
    }

    // ── A held stock that just got its setup gets that setup's exits ─────
    // (DAV-285). Only a fill wrote them, and 8 of the 9 held stocks were
    // bought before setups were named. Same triggers the fill would have
    // written, through the same ops core, after the agent's own ops so a
    // bucket it just filled is left alone. They are not plan levels, so the
    // columns and the plan check above are untouched — nothing is refused.
    if (
      args.setup_id !== undefined &&
      args.setup_id !== existing.setupId &&
      isNamedSetup(args.setup_id) &&
      (patch.status ?? existing.status) === "HOLDING" &&
      !isTerminalTransition &&
      parseTriggersResilient(existing.triggers).dropped === 0
    ) {
      const setup = getSetup(args.setup_id, await loadSetupOverrides(ctx.accountId));
      const base = (patch.triggers ?? parseTriggersResilient(existing.triggers).triggers) as Trigger[];
      const position = ctx.analystId
        ? await prisma.position.findFirst({
            where: { analystId: ctx.analystId, symbol: existing.ticker, status: "OPEN" },
            select: { avgCost: true, openedAt: true },
            orderBy: { openedAt: "desc" },
          })
        : null;
      const stop = (patch.stopLoss ?? existing.stopLoss) as number | { toString(): string } | null;
      const exitOps = setup
        ? heldSetupExitOps({
            setup,
            horizon: (patch.horizon ?? existing.horizon) as string | null,
            entry:
              position?.avgCost != null
                ? Number(position.avgCost)
                : existing.entryPrice != null
                  ? Number(existing.entryPrice)
                  : null,
            stop: stop != null ? Number(stop) : null,
            direction: ("direction" in patch ? patch.direction : existing.direction) as string | null,
            stored: base,
            mintId: () => randomUUID(),
            // The day count runs from the real buy, so the sessions-to-
            // calendar conversion is measured across the days this stock
            // actually lived through, not from today.
            boughtAt: position?.openedAt ?? undefined,
          })
        : [];
      if (exitOps.length > 0) {
        const written = applyTriggerOps({
          stored: base,
          inherited: inheritedLadder,
          ops: exitOps,
          direction: ("direction" in patch ? patch.direction : existing.direction) as string | null,
          status: "HOLDING",
          actor: "SYSTEM",
          now: new Date(),
          mintId: () => randomUUID(),
        });
        opResults.push(...written.results);
        if (written.results.some((r) => r.ok)) patch.triggers = written.triggers as unknown as object;
      }
    }

    // Status transitions get extra paperwork.
    let updateType: ThesisUpdateType = "UPDATED";
    if (args.change_status === "INVALIDATED") {
      // P1-24 B3: terminal collapse → RETIRED + retiredReason. The agent
      // verb (change_status:"INVALIDATED") is unchanged; the stored status
      // is RETIRED and the reason records why. invalidatedAt/invalidReason
      // still carry the narrative; updateType stays the audit event kind.
      patch.status = "RETIRED";
      patch.retiredReason = "INVALIDATED";
      patch.invalidatedAt = new Date();
      patch.invalidReason = args.rationale.slice(0, 500);
      updateType = "INVALIDATED";
    } else if (args.change_status === "ARCHIVED") {
      // Terminal-without-trade-or-invalidation. Used for agent/user walking
      // away from coverage (user UI remove; editor remove). NOT for a
      // researched-and-declined PASS — that's direction:"PASS" → status=PASSED
      // above. Distinct from INVALIDATED (view disproven by evidence). Exiting
      // a held position is close_position, which retires the thesis (sold)
      // itself — there's no agent CLOSED verb here anymore.
      // P1-24: walk-away ARCHIVED → RETIRED + retiredReason=DROPPED.
      patch.status = "RETIRED";
      patch.retiredReason = "DROPPED";
      patch.closedAt = new Date();
      patch.closeReason = args.rationale.slice(0, 500);
      // Existing ThesisUpdateType taxonomy doesn't have ARCHIVED. Use
      // STATUS_CHANGED so the audit log captures the from/to in fieldChanges.
      updateType = "STATUS_CHANGED";
    } else if (args.change_status === "WATCHING" && existing.status === "WATCHING") {
      // Already watching. The verb is a no-op and the rest of the call lands
      // as an ordinary review — VST 2026-09-23 and PLTR 2026-09-23 were
      // refused whole for this (watching_transition_from_non_promoted).
    } else if (args.change_status === "WATCHING") {
      // ── Back to WATCHING ────────────────────────────────────────────────
      // Two legal sources:
      //   • PROMOTED — the opt-out on the first live run. The analyst decides
      //     not to re-enter this name live; the next run re-evaluates.
      //     Conviction context (paperTenureDays / P&L / review count) stays
      //     on the row for reference; promotedAt clears.
      //   • RETIRED(SOLD) — a stock we sold, put back on watch after the one
      //     review every sale now gets (DAV-240). The terminal stamps come
      //     off so the row is an ordinary watch again: the five-minute check
      //     already scores WATCHING rows, so a re-entry level fires with
      //     nothing new built.
      const violation = checkWatchingOptOut(transitionInput);
      if (violation) {
        return {
          summary: violation.summary,
          data: { ok: false, ...violation.data },
          sources: [],
        };
      }
      patch.status = "WATCHING";
      patch.promotedAt = null;
      if (existing.status === "RETIRED") {
        patch.retiredReason = null;
        patch.closedAt = null;
        patch.closeReason = null;
      }
      updateType = "STATUS_CHANGED";
    }
    // P1-24: the legacy WATCHING/PROMOTED → ACTIVE promotion path was removed
    // from this tool. Entering a position is place_trade (it flips the thesis
    // WATCHING/PROMOTED → HOLDING atomically with the Alpaca fill and computes
    // the levels from the actual entry); the agent no longer sets a holding
    // status via update_thesis.

    // ── Stamp when we looked (DAV-193, relocated by DAV-195 L7) ─────────
    // The clock counts from when we last LOOKED, so there is nothing to
    // compute: record the fact and let the cadence trigger do the
    // arithmetic. Every surface that shows a review date derives it at
    // read time from this stamp (DAV-221 — the cached column is gone).
    //
    // A decline is not a review and never reaches here — declining a sell
    // proposal leaves the market condition true, so that trigger fires again
    // tomorrow, unchanged. This is the other thing: the analyst looked, even
    // if it concluded nothing changed. If a run skips the thesis or crashes,
    // nothing is stamped and it stays due.
    if (patch.status !== "RETIRED" && patch.status !== "PASSED") {
      patch.lastReviewedAt = new Date();
    }

    // ── Narrative-only patches collapse to REVIEWED ──────────────────────
    // A "narrative-only" patch touches only fields the agent can fill on
    // every housekeeping pass without anything structural having changed:
    // a rewritten reasoningSummary, a re-keyed riskFlags list, refreshed
    // thesisBullets. Under gpt-4o the agent would
    // call update_thesis(rationale) with no other fields and the
    // empty-patch path below classified the row as REVIEWED. Under gpt-5.5
    // (swap day 2026-05-12) the agent is verbosely chattier and fills
    // narrative fields on every closeout, so the audit log collapsed: 0
    // REVIEWED rows from morning-runs since the swap, all 18-37 daily
    // UPDATED. That destroys the audit-log signal — run-reviews can no
    // longer separate "agent reviewed it" from "agent actually changed
    // something."
    //
    // Solution: classify a non-empty patch that touches only narrative
    // keys as REVIEWED, same as the empty-patch path below. Status
    // transitions (already set above as INVALIDATED/CLOSED/STATUS_CHANGED)
    // stay as-is — narrative reclassification only applies to the default
    // UPDATED bucket.
    //
    // A7 from docs/plans/SYSTEM_AUDIT_2026_05_19.md.
    // PR-9 flat schema: the patch writes `snapshot` / `bullCase` / `bearCase`
    // (the legacy reasoning_summary / thesis_bullets / risk_flags args are
    // wrapped into those keys above), so the narrative set must name the keys
    // that actually land in the patch. `researchUpdatedAt` rides along — it is
    // auto-stamped whenever any narrative section arrives, and must not make a
    // narrative-only patch look structural. The stale legacy names here were
    // half of the empty-diff audit hole (GAPS P2, prerequisite for P1-33):
    // narrative refreshes stopped collapsing to REVIEWED and instead landed as
    // UPDATED rows whose diff dropped every key.
    const NARRATIVE_KEYS = new Set([
      "snapshot",
      "bullCase",
      "bearCase",
      "researchUpdatedAt",
    ]);
    // The review stamp above is when we looked, not a change. Since it went
    // into the patch (2026-08-25) every call counted as a change: runs wrote
    // no REVIEWED row for six weeks, and the declined-sale bar in
    // complete_run, which a review must not clear, cleared on any call.
    const changedKeys = Object.keys(patch).filter((k) => k !== "lastReviewedAt");
    const isNarrativeOnly =
      changedKeys.length > 0 &&
      updateType === "UPDATED" &&
      changedKeys.every((k) => NARRATIVE_KEYS.has(k));
    if (isNarrativeOnly) {
      updateType = "REVIEWED";
    }

    // Empty patch (only rationale supplied)? That's a REVIEWED row, not
    // an UPDATED row. Useful when housekeeping looks at a thesis and
    // decides it's still right — we want a paper trail of "agent looked
    // here on this date" without polluting the diff log.
    //
    // A REVIEWED-only touch stamps the same clock as any other review —
    // looking IS the event, whether or not anything changed. The horizon
    // cadence lookup that used to live here is gone with the second copy of
    // the review clock; the cadence is a trigger now and it reads this stamp.
    if (changedKeys.length === 0) {
      if (ctx.dryRun) return dryRunPassed(existing.ticker, opResults);
      const reviewedAt = new Date();
      await prisma.thesis.update({
        where: { id: existing.id },
        data: { lastReviewedAt: reviewedAt },
      });

      // Awaited (was void). Both the morning-research coverage gate and
      // the tactical-run close-out gate query ThesisUpdate immediately
      // after the agent finishes — fire-and-forget races caused false
      // FAILED on legitimate REVIEWED-only runs.
      await writeThesisUpdate({
        thesisId: existing.id,
        type: "REVIEWED",
        summary: `Reviewed ${existing.ticker} thesis — no changes`,
        rationale: args.rationale,
        runId: ctx.runId,
        triggerId: args.trigger_id,
        priceAtTime: resolvedPriceAtTime,
      });
      const reviewedMeans = whatThisMeans(existing, resolvedPriceAtTime, ctx.minConfidence);
      return {
        summary: `Reviewed ${existing.ticker} thesis: no changes.${reviewedMeans.length ? ` ⚠ ${reviewedMeans[0]}` : ""}`,
        data: {
          ok: true,
          thesis_id: existing.id,
          type: "REVIEWED" as const,
          trigger_ops: opResults,
          ...(reviewedMeans.length ? { what_this_means: reviewedMeans } : {}),
          card: thesisToCardData({ ...existing, lastReviewedAt: reviewedAt }),
        },
        sources: [],
      };
    }

    // Compute the diff BEFORE applying so the field-changes payload reflects
    // only what actually moved.
    //
    // These are the keys the patch above can actually write (PR-9 flat
    // schema). The pre-PR-9 legacy names (reasoningSummary / thesisBullets /
    // riskFlags / confidenceScore) sat here long after the patch stopped
    // writing them, so every narrative/scoring/section change fell through
    // the diff — 47% of UPDATED rows carried an empty fieldChanges (GAPS P2
    // audit hole, prerequisite for P1-33). Keep this list in lockstep with
    // the patch assembly above.
    const diffFields = [
      // Narrative (flat schema)
      "snapshot",
      "bullCase",
      "bearCase",
      // Research sections (V2)
      "recentCatalysts",
      "fundamentals",
      "latestEarnings",
      "catalystsAndEvents",
      "analystConsensus",
      "insiderTechnical",
      "researchData",
      // Belief
      "coreBelief",
      "keyAssumptions",
      "invalidationConds",
      // Conviction + scoring
      "scoring",
      "conviction",
      "convictionRationale",
      "variantView",
      // Trade plan
      "direction",
      "entryPrice",
      "targetPrice",
      "stopLoss",
      "horizon",
      "catalystDate",
      // Lifecycle
      "status",
      "retiredReason",
    ] as const;
    // Bulky JSONB sections store a short preview instead of two full copies
    // per row. Scalars keep exact from/to. The trigger list is NOT diffed:
    // the ops the caller sent are the change, stored verbatim below, and the
    // Activity feed renders those lines ("Entry $183 → $190").
    const BULKY_DIFF_KEYS = [
      "snapshot",
      "bullCase",
      "bearCase",
      "recentCatalysts",
      "fundamentals",
      "latestEarnings",
      "catalystsAndEvents",
      "analystConsensus",
      "insiderTechnical",
      "researchData",
    ] as const;
    const prevSnapshot = Object.fromEntries(
      diffFields.map((f) => [f, (existing as Record<string, unknown>)[f]]),
    );
    const nextSnapshot: Record<string, unknown> = { ...prevSnapshot };
    for (const [k, v] of Object.entries(patch)) {
      if (k in nextSnapshot) nextSnapshot[k] = v;
    }
    const fieldChanges = compactFieldChanges(
      diffThesisFields(prevSnapshot, nextSnapshot, [...diffFields]),
      BULKY_DIFF_KEYS,
    );
    const landedOps = acceptedOps(opResults);
    if (landedOps.length > 0) fieldChanges.triggerOps = { from: null, to: landedOps };

    // The structural-belief gate that lived here (P0-1) is gone. It refused
    // any change to the target or the floor unless a belief field changed or
    // `structural_unchanged_reason` was sent — and because levels are
    // triggers, "setting the plan down" tripped it too: GD 2026-09-25 and
    // ISRG 2026-09-23 were refused for removing their floor and target
    // triggers, and each run got past it by copying its rationale into
    // `structural_unchanged_reason`. A gate satisfied by repeating the
    // sentence next to it is not a gate. A level change already carries
    // its rationale; that is the record. The optional reason field that
    // outlived the gate printed "[Belief unchanged: …]" under 94 of 274
    // Activity notes in the ten days to 2026-10-05, often the note again
    // word for word; it went with the voice rules (lib/agent/voice.ts).

    // Check-only call: every refusal above has had its chance.
    if (ctx.dryRun) return dryRunPassed(existing.ticker, opResults);

    // Apply.
    try {
      await prisma.thesis.update({
        where: { id: existing.id },
        data: patch as object,
      });
    } catch (updErr: unknown) {
      // THESIS_RESEARCH_V2 fallback — mirrors record_thesis.ts. If the
      // Prisma client is out of sync with the schema (e.g. the V2 columns
      // haven't been regenerated locally), retry the update without those
      // fields so the rest of the patch lands. Loud log so we notice if
      // this fires in production — the schema migration shipped in
      // PR #278 + PR-9 so it should never trigger, but the strip mirrors
      // record_thesis's defense-in-depth.
      const errMsg = updErr instanceof Error ? updErr.message : String(updErr);
      const isUnknownArgError =
        errMsg.includes("Unknown arg") ||
        errMsg.includes("Unknown argument") ||
        (errMsg.includes("researchData") && errMsg.includes("does not exist")) ||
        (errMsg.includes("researchUpdatedAt") && errMsg.includes("does not exist")) ||
        (errMsg.includes("snapshot") && errMsg.includes("does not exist")) ||
        (errMsg.includes("bullCase") && errMsg.includes("does not exist")) ||
        (errMsg.includes("bearCase") && errMsg.includes("does not exist"));
      const hasV2Field =
        "researchData" in patch ||
        "researchUpdatedAt" in patch ||
        "snapshot" in patch ||
        "bullCase" in patch ||
        "bearCase" in patch ||
        "recentCatalysts" in patch ||
        "fundamentals" in patch ||
        "latestEarnings" in patch ||
        "catalystsAndEvents" in patch ||
        "analystConsensus" in patch ||
        "insiderTechnical" in patch;
      if (isUnknownArgError && hasV2Field) {
        console.error(
          `[tool] update_thesis V2 FALLBACK for ${existing.ticker}: stripping V2 research columns. Prisma client appears out of sync. Full error: ${errMsg}`,
        );
        const {
          researchData: _rdata,
          researchUpdatedAt: _rupdated,
          snapshot: _snap,
          bullCase: _bcase,
          bearCase: _xcase,
          recentCatalysts: _rcat,
          fundamentals: _fund,
          latestEarnings: _learn,
          catalystsAndEvents: _cae,
          analystConsensus: _acons,
          insiderTechnical: _itech,
          ...fallbackPatch
        } = patch;
        void _rdata;
        void _rupdated;
        void _snap;
        void _bcase;
        void _xcase;
        void _rcat;
        void _fund;
        void _learn;
        void _cae;
        void _acons;
        void _itech;
        await prisma.thesis.update({
          where: { id: existing.id },
          data: fallbackPatch as object,
        });
      } else {
        throw updErr;
      }
    }

    // Watchlist-collapse: Thesis is now the single store. WATCHING →
    // terminal transitions automatically remove the thesis from the
    // watchlist view (which is just `WHERE status='WATCHING'`). No
    // mirror table to sync.

    // Build a punchy summary line for the timeline list view. The trigger
    // ops lead, one line each — a moved entry IS the entry change, not
    // "triggers updated" plus a separate column line.
    const summaryParts: string[] = landedOps.map((o) => o.text);
    if (fieldChanges.scoring) {
      const from = (fieldChanges.scoring.from as { composite?: number } | null)
        ?.composite;
      const to = (fieldChanges.scoring.to as { composite?: number } | null)
        ?.composite;
      summaryParts.push(
        from != null && to != null && from !== to
          ? `composite ${from} → ${to}`
          : "scoring updated",
      );
    }
    if (fieldChanges.status) {
      summaryParts.push(
        `${fieldChanges.status.from} → ${fieldChanges.status.to}`,
      );
    }
    if (
      fieldChanges.coreBelief ||
      fieldChanges.snapshot ||
      fieldChanges.bullCase ||
      fieldChanges.bearCase ||
      fieldChanges.invalidationConds ||
      fieldChanges.keyAssumptions
    ) {
      summaryParts.push("rationale updated");
    }
    if (
      fieldChanges.recentCatalysts ||
      fieldChanges.fundamentals ||
      fieldChanges.latestEarnings ||
      fieldChanges.catalystsAndEvents ||
      fieldChanges.analystConsensus ||
      fieldChanges.insiderTechnical ||
      fieldChanges.researchData
    ) {
      summaryParts.push("research refreshed");
    }
    const verb = updateType === "REVIEWED" ? "Reviewed" : "Updated";
    const summary =
      summaryParts.length > 0
        ? `${verb} ${existing.ticker}: ${summaryParts.join(", ")}`
        : `${verb} ${existing.ticker} thesis`;

    // Awaited (was void). The tactical-run close-out gate and the
    // morning-research coverage gate both query ThesisUpdate the moment
    // the agent finishes; fire-and-forget races dropped the row past
    // the gate's read horizon and false-failed legitimate runs.
    await writeThesisUpdate({
      thesisId: existing.id,
      type: updateType,
      summary,
      rationale: args.rationale,
      fieldChanges,
      runId: ctx.runId,
      triggerId: args.trigger_id,
      priceAtTime: resolvedPriceAtTime,
    });
    const means = whatThisMeans({ ...existing, ...patch }, resolvedPriceAtTime, ctx.minConfidence);

    return {
      summary: means.length ? `${summary} ⚠ ${means[0]}` : summary,
      data: {
        ok: true,
        thesis_id: existing.id,
        type: updateType,
        changed_fields: Object.keys(fieldChanges),
        trigger_ops: opResults,
        ...(means.length ? { what_this_means: means } : {}),
        // Post-update thesis snapshot for the chat renderer. Merges the
        // pre-update record with the patch we just applied — no extra DB
        // read. Drives the "Wrote / edited theses" carousel.
        card: thesisToCardData({ ...existing, ...patch }),
      },
      sources: [],
    };
  },
});


/**
 * The save's reply (docs/plans/AGENT_CONTEXT.md §3.6): what the saved plan
 * means, in the sheet's words (plan-sanity.ts). Words, never a refusal. EME
 * 2026-09-29: a buy armed at a score of 6 against this analyst's 7 got only
 * "composite 3 → 6" back; told, the chat fixed it in one turn.
 */
function whatThisMeans(row: Record<string, unknown>, price: number | null, minConfidence?: number | null): string[] {
  const n = (v: unknown) => (v == null ? null : Number(v));
  const flags = computePlanSanity({
    status: String(row.status), direction: (row.direction as string | null) ?? null, currentPrice: price,
    entryPrice: n(row.entryPrice), targetPrice: n(row.targetPrice), stopLoss: n(row.stopLoss),
    composite: getThesisComposite(row as never), minConfidence: minConfidence ?? null,
  });
  // The score line is about a buy; with no buy price there is none to refuse.
  return flags.filter((f) => f.kind !== "COMPOSITE_BELOW_MINIMUM" || n(row.entryPrice) != null).map((f) => `${row.ticker}: ${f.text}`);
}

/**
 * Map a Thesis row (from prisma) to the ThesisCardData shape consumed by
 * ThesisCardRenderer. Same shape that record_thesis returns.
 */
function thesisToCardData(t: Record<string, unknown>): {
  thesis_id: string;
  ticker: string;
  // P1-24: `LONG | SHORT | null`. A pass stores direction=null and carries
  // the pass fact on status=PASSED below; the renderer + sheet key on status.
  direction: "LONG" | "SHORT" | null;
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration?: string;
  signal_types: string[];
  status: "HOLDING" | "WATCHING" | "PROMOTED" | "RETIRED" | "PASSED";
} {
  return {
    thesis_id: t.id as string,
    ticker: t.ticker as string,
    direction: (t.direction as "LONG" | "SHORT" | null) ?? null,
    confidence_score: (t.confidenceScore as number) ?? 0,
    reasoning_summary: (t.reasoningSummary as string) ?? "",
    thesis_bullets: (t.thesisBullets as string[]) ?? [],
    risk_flags: (t.riskFlags as string[]) ?? [],
    entry_price:
      typeof t.entryPrice === "number" ? (t.entryPrice as number) : null,
    target_price:
      typeof t.targetPrice === "number" ? (t.targetPrice as number) : null,
    stop_loss:
      typeof t.stopLoss === "number" ? (t.stopLoss as number) : null,
    // Hold duration is now derived from `horizon` at card-data assembly
    // time (PR-4 — the legacy column drops in PR-5). Falls back to the
    // legacy column for rows that don't yet have horizon set.
    hold_duration:
      typeof t.horizon === "string" && t.horizon.length > 0
        ? holdDurationFromHorizon(t.horizon)
        : ((t.holdDuration as string) ?? undefined),
    signal_types: (t.signalTypes as string[]) ?? [],
    status: (t.status as
      | "HOLDING"
      | "WATCHING"
      | "PROMOTED"
      | "RETIRED"
      | "PASSED") ?? "WATCHING",
  };
}
