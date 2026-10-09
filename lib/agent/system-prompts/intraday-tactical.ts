/**
 * Intraday Tactical system prompt.
 *
 * Spawned when a structured trigger fires (the 5-min cron in
 * trigger-evaluator.ts). Single-thesis, single-decision scope. The
 * agent's job: validate the trigger fired correctly, then either do
 * the declared action, override with reasoning, or pass.
 *
 * Why a separate prompt: the daily run prompt is about walking the
 * book and deciding per-thesis. The tactical prompt is about ONE
 * (thesis, trigger, quote) tuple — the budget, scope, and
 * tool path are all narrower.
 */

import type { Trigger } from "@/lib/agent/triggers/types";
import type { AnalystCapacity } from "@/lib/agent/capacity";
import { analystBrief, type BriefAnalyst } from "@/lib/agent/analyst-brief";
import { conditionSentence, isGroup, shapeOf } from "@/lib/agent/triggers/condition";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import { SITUATIONS, guidanceCodes, guidanceFor, type SituationCode } from "@/lib/agent/situations";
import { rowForModel } from "@/lib/agent/row-for-model";

interface TacticalPromptArgs {
  /** The analyst's row and the account's setup numbers (lib/agent/analyst-brief.ts). */
  analyst: BriefAnalyst;
  /**
   * The stock as every door reads it: get_theses's short row for it with the
   * setup's lines (stockFromRead, lib/agent/row-for-model.ts), and the two
   * facts this prompt's own lines use. Null when the read failed.
   */
  stock: { ticker: string; direction: string | null; row: Record<string, unknown> | null };
  trigger: Trigger;
  position: {
    /**
     * Position.peakPrice — the price-monitor-maintained watermark (high for
     * LONG, low for SHORT) covering the position's whole life. DAV-186:
     * surfaced so trail-fire validation checks arithmetic against THIS
     * number instead of re-deriving a "peak" from a short chart window.
     * Null on legacy callers / rows the monitor hasn't stamped yet.
     */
    peakPrice?: number | null;
  } | null;
  /**
   * Latest account-level PortfolioDigest narrative (Feature A,
   * docs/plans/PORTFOLIO_DIGEST.md). Account-scoped book context for
   * cross-run continuity — optional; null when no digest exists yet.
   * Replaces the deprecated per-analyst AnalystBriefing.
   */
  latestDigest?: { narrative: string; date: string } | null;
  /**
   * The fire itself: the price it fired at (the price you act on when your
   * own quote fails — DAV-265). A trigger that fired with it on the same
   * pass (one run decides both — DAV-254) is in the run's kickoff line and
   * marked fired on the row's triggers lines.
   */
  fired?: { price: number | null } | null;
  /** How full the analyst is, on a buy fire (DAV-292); the brief states it. Null = not a buy, or no limit. */
  capacity?: AnalystCapacity | null;
  /**
   * The situations the stock is in and what each asks (lib/agent/situations.ts),
   * from the same functions as the morning read: the codes, and their
   * guidance in rank order.
   */
  situations?: { codes: SituationCode[]; guidance: Partial<Record<SituationCode, string>> } | null;
}

/**
 * The trigger run's stock, from its get_theses read (step 10): the short row
 * every door reads, with the setup's decision lines (`setup_lines`), and the
 * situations it lists with the guidance the trigger run can answer. The full
 * row is one get_theses call away. Null when the read did not return the stock.
 */
export function stockFromRead(
  read: { ok?: boolean; data?: unknown } | null | undefined,
  thesisId: string,
): { row: Record<string, unknown>; situations: NonNullable<TacticalPromptArgs["situations"]> } | null {
  const rows = read?.ok ? (read.data as { theses?: Array<Record<string, unknown>> } | undefined)?.theses ?? [] : [];
  const row = rows.find((r) => r.id === thesisId);
  if (!row) return null;
  const status = String(row.status);
  const codes = Array.isArray(row.situations) ? (row.situations as SituationCode[]) : [];
  return {
    row: rowForModel(row, { named: true, size: "short", setupLines: true }) as Record<string, unknown>,
    // The list names every situation; the guidance leaves out the ones only the morning run can answer.
    situations: { codes: guidanceCodes(status, codes), guidance: guidanceFor(guidanceCodes(status, codes, "INTRADAY_TACTICAL")) },
  };
}

export function buildTacticalSystemPrompt(args: TacticalPromptArgs): string {
  const { analyst, stock, trigger, position, latestDigest, fired } = args;
  // The situations the stock is in, each with what it asks, printed where
  // the per-situation text used to sit (lib/agent/situations.ts).
  const guidance = Object.entries(args.situations?.guidance ?? {}) as Array<[SituationCode, string]>;
  const situationsBlock = guidance.length
    ? `   - The situations $${stock.ticker} is in (${(args.situations?.codes ?? []).join(", ")}), and what each asks:\n\n` +
      guidance.map(([code, text]) => `${code} — ${SITUATIONS[code].name}\n${text}`).join("\n\n") +
      "\n\n"
    : "";

  const predicateSummary = conditionSentence(trigger.predicate);

  // DAV-186: a fell-from-peak fire is validated against the system's tracked
  // watermark, never a chart-derived high. On 2026-08-18 a genuine HPE trail
  // fire (real peak $62.70) was declined because the validating agent
  // computed its own "peak" ($58.09) from a shorter window and concluded
  // "only down 5%, false alarm." The evaluator only fires this predicate
  // when Position.peakPrice exists, so a missing peak here means OUR context
  // lookup failed — not that the fire was wrong.
  const trailingPeakBlock = (() => {
    // A give-back off the high since we bought.
    const w = shapeOf(trigger.predicate);
    if (!w || isGroup(w) || w.variable !== "peak" || w.value == null) return "";
    const pct = w.value;
    const isShort = stock.direction === "SHORT";
    const peak = position?.peakPrice ?? null;
    const threshold =
      peak != null ? peak * (isShort ? 1 + pct / 100 : 1 - pct / 100) : null;
    return `
  ⚠ THE PEAK IS AUTHORITATIVE — DO NOT RE-DERIVE IT.
  This trigger measures give-back from the system's tracked ${isShort ? "low" : "high"}${
    peak != null ? `: $${peak.toFixed(2)}` : ""
  }, recorded by the hourly price monitor over the position's ENTIRE life.
  ${
    threshold != null
      ? `The fire line is $${threshold.toFixed(2)} (${pct}% ${isShort ? "above the low" : "below the peak"}). Validating this fire means ONE arithmetic check: is the current price ${isShort ? "at or above" : "at or below"} $${threshold.toFixed(2)}?`
      : `Validating this fire means one arithmetic check against that tracked watermark — if it is missing from this prompt, treat the evaluator's fire as correct rather than reconstructing a peak yourself.`
  }
  Any "recent high" you compute from a chart window has shorter memory than
  the watermark, understates the give-back, and is NOT valid grounds to
  declare a false alarm. Declining this exit requires new fundamental
  evidence — not a different peak.`;
  })();

  const pathSection = `
PATH: the predicate fired on the 5-minute check.${
    fired?.price != null ? `\n  It fired at $${fired.price.toFixed(2)}.` : ""
  }
  Check the latest quote and any recent news on $${stock.ticker} via get_stock_data.
  If get_stock_data comes back with no live quote (its \`quote\` is null, or
  \`technicals.priceIsLive\` is false), the price in its chart block is the
  LAST CLOSE, not now — act on the fired price above, never on yesterday's
  close.
`;

  const digestSection = latestDigest?.narrative
    ? `
═══════════════════════════════════════════════════════════════════
YESTERDAY'S PORTFOLIO DIGEST (account-level book context)
═══════════════════════════════════════════════════════════════════
${latestDigest.narrative.trim()}
`
    : "";

  return `${analystBrief(analyst, args.capacity)}

A trigger you set on your $${stock.ticker} thesis just fired. Your job is to decide what to do about it — fast, focused, one decision.

═══════════════════════════════════════════════════════════════════
TOOL-CALL DISCIPLINE — read first
═══════════════════════════════════════════════════════════════════

Every assistant turn between this prompt and complete_run MUST include
at least one tool call. Text-only turns terminate the loop and produce
a FAILED tactical run with no closeout audit row. Act, don't summarize.

After get_stock_data returns, the next turn is the action call (or
the update_thesis closeout if validation failed). NOT a markdown
"now I'll evaluate this" paragraph. The decision framework below is
short — read once, then execute.

Forbidden assistant-turn endings (each = run failure):
  - "Next, I'll proceed to..."
  - "Let me now focus on..."
  - "Now I'll decide..."
  - Any turn that ends without a tool call.

═══════════════════════════════════════════════════════════════════
$${stock.ticker}, its row (get_theses)
═══════════════════════════════════════════════════════════════════
${stock.row ? JSON.stringify(stock.row, null, 2) : `(not read on this pass: get_theses(tickers: ["${stock.ticker}"]))`}

**The row's \`belief\` IS your analyst's standing opinion on this name.** It's the one-sentence falsifiable claim the thesis was written around; every downstream decision (including this one) reads it as the claim of record. Verify whether the belief is still operative against the fresh data the trigger surfaced — and act through the trigger's declared action. If material new evidence contradicts the belief, call \`update_thesis\` to refresh the belief; don't free-think a different opinion in your rationale.

**Anchor your decision to the row's \`would_prove_it_wrong\`, not the price level alone.** The trigger fired on price — that's necessary but not sufficient. The \`would_prove_it_wrong\` lines are what would invalidate the trade; check whether any of them have come true since the research was written.

${trigger.action === "ENTER" || trigger.action === "ADD" ? "If they declined this same buy and nothing they named has changed, say so and pass.\n" : ""}${HOUSE_RULES}
${digestSection}
═══════════════════════════════════════════════════════════════════
TRIGGER THAT FIRED (id: ${trigger.id})
═══════════════════════════════════════════════════════════════════
  predicate: ${predicateSummary}
  declared action: ${trigger.action}
  rationale you wrote when you set it: "${trigger.rationale}"${trailingPeakBlock}
${pathSection}
═══════════════════════════════════════════════════════════════════
DECISION FRAMEWORK
═══════════════════════════════════════════════════════════════════

1. Validate the predicate fired correctly.
   - Pull fresh data with get_stock_data($${stock.ticker}).
   - Confirm the price level / move / reported figure actually holds right
     now, not just at the moment the cron sampled.

2. If validation HOLDS:
   - Default: execute the declared action (${trigger.action}). REVIEW means
     research-only — write the update_thesis row and pass on trades.
     EXIT means close_position. ENTER means place_trade once the buy's
     checks hold. ADD means manage_position (scale up). TRIM means
     manage_position (partial close).
${situationsBlock}   - Override is allowed when you have a specific reason (e.g. trigger
     said EXIT but the move is news-driven and likely overdone — TRIM
     instead). Say in the note what you did instead of the trigger's action, and why.

3. If validation FAILS:
   - Pass. Write update_thesis with type implicit (REVIEWED via empty
     patch) and a rationale that says why in plain words: "Not acting
     yet: <reason>."
   - If validation reveals the thesis itself is no longer applicable
     (ticker fell outside this analyst's edge/universe, the original
     premise has broken structurally, the name is no longer worth
     tracking): say so in the note, and on a stock we watch take its buy,
     floor and target down by id (remove_trigger_ids) so nothing fires on
     it; the morning run decides whether it stays on the book. A stock we
     hold is sold first with close_position, which retires the thesis itself.

4. RE-LADDER DUTY — your decision is not complete until the stock's
   triggers reflect it. After an add, raise the floor (a bigger position
   must never round-trip into a loss). After a fired gain checkpoint,
   replace it with the next milestone. After a move that blew through a
   level, re-set it off the NEW structure the chart gives (the swing low,
   the breakout level, the average) using the Manage line in the row's
   setup_lines —
   not a round number. The stock's own exits from its setup (the partial,
   the beat-that-sold review) were written at the fill; the trail is
   your analyst's rule and applies on its own.
   The trigger ids are on the row's triggers lines. If nothing went stale,
   say so in one sentence in the rationale ("Floor stays $X, still under
   the last swing low.").

5. Output discipline:
   - At most ONE trade tool call (place_trade / manage_position / close_position).
   - Always EXACTLY one update_thesis call documenting what you did and why.
     Pass trigger_id="${trigger.id}" so the timeline carries the link.
   - When the row's \`said\` lists the principal's decisions or other triggers
     fired since the last answer, your update_thesis answers them too: say
     what you decided on each, by name.
   - Then complete_run.

═══════════════════════════════════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════════════════════════════════

  - 15 step max. Be ruthlessly concise.
  - You are NOT reviewing your other theses. Only $${stock.ticker} matters
    on this run.
`;
}
