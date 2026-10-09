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
import { conditionSentence, isGroup, sentenceOf, shapeOf } from "@/lib/agent/triggers/condition";
import { getSetup } from "@/lib/agent/knowledge/setups";
import type { SetupOverrides } from "@/lib/agent/knowledge/setup-overrides";
import type { ResearchAge } from "@/lib/agent/thesis-research/staleness";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import type { HeldThroughFloor } from "@/lib/agent/stock-facts";

interface TacticalPromptArgs {
  /** The analyst's row and the account's setup numbers (lib/agent/analyst-brief.ts). */
  analyst: BriefAnalyst;
  thesis: {
    id: string;
    ticker: string;
    direction: string | null;
    horizon: string | null;
    /** The setup the plan was written on (Thesis.setupId); null on rows older than #644. */
    setupId?: string | null;
    coreBelief: string | null;
    keyAssumptions: string[];
    invalidationConds: string[];
    entryPrice: number | null;
    targetPrice: number | null;
    stopLoss: number | null;
    // Phase 1 read-side fix: deep-research excerpt rendered inline so
    // the tactical agent reads the analyst's narrative + top bull/bear
    // bullets + research freshness before executing the trigger's
    // declared action. snapshotText is the prose paragraph; bullCase /
    // bearCase are top bullets; researchAge is the freshness annotation.
    snapshotText: string | null;
    bullCaseBullets: string[];
    bearCaseBullets: string[];
    researchAge: ResearchAge;
    /**
     * The FULL current trigger ladder (parsed), fired rung included, with
     * ids: the tactical agent's decision must leave the ladder correct
     * (re-ladder duty), and it edits triggers one at a time by id.
     */
    allTriggers: Trigger[];
  };
  trigger: Trigger;
  position: {
    quantity: number;
    avgCost: number;
    daysHeld: number;
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
   * What's been said on the stock (stock-context.ts): the principal's
   * decisions of the last 30 days word for word, the last two answers, the
   * fires no agent has answered. Rendered in tactical-run.ts; null when
   * nothing has been said.
   */
  context: string | null;
  /**
   * Latest account-level PortfolioDigest narrative (Feature A,
   * docs/plans/PORTFOLIO_DIGEST.md). Account-scoped book context for
   * cross-run continuity — optional; null when no digest exists yet.
   * Replaces the deprecated per-analyst AnalystBriefing.
   */
  latestDigest?: { narrative: string; date: string } | null;
  /**
   * The fire itself: the price it fired at (the price you act on when your
   * own quote fails — DAV-265) and any protective triggers that fired with
   * it on the same pass (one run decides both — DAV-254).
   */
  fired?: {
    price: number | null;
    coFired: Array<{ triggerId: string; sentence: string }>;
  } | null;
  /** The account's playbook numbers laid over the catalog (DAV-273). */
  setupOverrides?: SetupOverrides | null;
  /** How full the analyst is, on a buy fire (DAV-292); the brief states it. Null = not a buy, or no limit. */
  capacity?: AnalystCapacity | null;
  /**
   * The situations the stock is in and what each asks (lib/agent/situations.ts),
   * from the same functions as the morning read: the codes, and their
   * guidance in rank order.
   */
  situations?: { codes: SituationCode[]; guidance: Partial<Record<SituationCode, string>> } | null;
  /** A protective sale the principal declined, still past its floor: the morning row's field, by the same name. */
  heldThroughFloor?: HeldThroughFloor | null;
}

export function buildTacticalSystemPrompt(args: TacticalPromptArgs): string {
  const { analyst, thesis, trigger, position, context, latestDigest, fired } = args;
  const setup = thesis.setupId ? getSetup(thesis.setupId, args.setupOverrides ?? undefined) : undefined;
  const coFiredIds = new Set((fired?.coFired ?? []).map((c) => c.triggerId));
  // The situations the stock is in, each with what it asks, printed where
  // the per-situation text used to sit (lib/agent/situations.ts).
  const guidance = Object.entries(args.situations?.guidance ?? {}) as Array<[SituationCode, string]>;
  const situationsBlock = guidance.length
    ? `   - The situations $${thesis.ticker} is in (${(args.situations?.codes ?? []).join(", ")}), and what each asks:\n\n` +
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
    const isShort = thesis.direction === "SHORT";
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

  const positionLine = position
    ? `qty ${position.quantity}, avgCost $${position.avgCost.toFixed(2)}, ${position.daysHeld} days held${
        position.peakPrice != null
          ? `, tracked peak $${position.peakPrice.toFixed(2)} (the system's remembered ${thesis.direction === "SHORT" ? "low" : "high"} for this position — authoritative)`
          : ""
      } — current price + unrealized P&L are NOT in this prompt; pull them via get_stock_data`
    : "no position (thesis is WATCHING — promotion is on the table)";

  const pathSection = `
PATH: the predicate fired on the 5-minute check.${
    fired?.price != null ? `\n  It fired at $${fired.price.toFixed(2)}.` : ""
  }
  Check the latest quote and any recent news on $${thesis.ticker} via get_stock_data.
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

A trigger you set on your $${thesis.ticker} thesis just fired. Your job is to decide what to do about it — fast, focused, one decision.

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
THESIS (id: ${thesis.id})
═══════════════════════════════════════════════════════════════════
  direction: ${thesis.direction}, horizon: ${thesis.horizon ?? "(unset)"}
  core belief: ${thesis.coreBelief ?? "(unset)"}
  key assumptions: ${thesis.keyAssumptions.length ? thesis.keyAssumptions.join("; ") : "(none recorded)"}
  invalidation conditions: ${thesis.invalidationConds.length ? thesis.invalidationConds.join("; ") : "(none recorded)"}
  entry: ${thesis.entryPrice != null ? `$${thesis.entryPrice}` : "(unset)"}, target: ${thesis.targetPrice != null ? `$${thesis.targetPrice}` : "(unset)"}, stop: ${thesis.stopLoss != null ? `$${thesis.stopLoss}` : "(unset)"}

THE SETUP THIS PLAN WAS WRITTEN ON
${
  setup
    ? `  ${setup.id} — ${setup.name} (${thesis.horizon ?? "horizon unset"})
  Confirm a buy by: ${setup.entry.confirmation.length ? setup.entry.confirmation.join("; ") : "the level holding"}${
        setup.entry.chaseLimitPct != null ? `; not more than ${setup.entry.chaseLimitPct}% past the level` : ""
      }
  Failure looks like: ${setup.failureSigns.join("; ")}
  Manage: ${setup.trail[(thesis.horizon ?? "TARGET") as keyof typeof setup.trail] ?? Object.values(setup.trail)[0] ?? "the plan's stop and target"}
  Time: ${setup.time.text}`
    : `  (none recorded — a plan from before setups were named. Confirm the price holds and no headline contradicts; volume is context, not a gate.)`
}

DEEP-RESEARCH EXCERPT [${thesis.researchAge.freshness === "missing" ? "research MISSING" : `research ${thesis.researchAge.freshness} (${thesis.researchAge.daysOld}d)`}]:
${thesis.snapshotText ? `  snapshot: ${thesis.snapshotText.length > 360 ? `${thesis.snapshotText.slice(0, 360)}…` : thesis.snapshotText}` : "  snapshot: (none)"}
${
  thesis.bullCaseBullets.length > 0
    ? `  bull case (top ${Math.min(3, thesis.bullCaseBullets.length)}):\n${thesis.bullCaseBullets
        .slice(0, 3)
        .map((b) => `    + ${b.length > 200 ? `${b.slice(0, 200)}…` : b}`)
        .join("\n")}`
    : "  bull case: (none recorded)"
}
${
  thesis.bearCaseBullets.length > 0
    ? `  bear case (top ${Math.min(3, thesis.bearCaseBullets.length)}):\n${thesis.bearCaseBullets
        .slice(0, 3)
        .map((b) => `    − ${b.length > 200 ? `${b.slice(0, 200)}…` : b}`)
        .join("\n")}`
    : "  bear case: (none recorded)"
}
${
  thesis.researchAge.freshness === "missing" ||
  thesis.researchAge.freshness === "stale"
    ? `  ⚠ Research is ${thesis.researchAge.freshness === "missing" ? "MISSING (never written)" : `${thesis.researchAge.daysOld} days STALE (horizon threshold ${thesis.researchAge.horizonThreshold ?? "n/a"}d)`}.

     Act on the trigger anyway; the daily run handles the refresh. The bull/bear case above + the read on the current quote + the trigger's declared action is enough to validate or override. If the bear-case bullets have come true since the research was written, that's a REVIEW outcome (write update_thesis with the invalidation reason).`
    : ""
}

**\`coreBelief\` IS your analyst's standing opinion on this name.** It's the one-sentence falsifiable claim the thesis was written around; every downstream decision (including this one) reads it as the claim of record. Verify whether the belief is still operative against the fresh data the trigger surfaced — and act through the trigger's declared action. If material new evidence contradicts coreBelief, call \`update_thesis\` to refresh the belief; don't free-think a different opinion in your rationale.

**Anchor your decision to the bull/bear case above, not the price level alone.** The trigger fired on price — that's necessary but not sufficient. The bear-case bullets are what would invalidate the trade; check whether any of them have come true since the research was written.

POSITION:
  ${positionLine}

${context ?? `WHAT'S BEEN SAID ON $${thesis.ticker}\n  (nothing written on this stock in the lines on record)`}${args.heldThroughFloor ? `\n  heldThroughFloor: ${JSON.stringify(args.heldThroughFloor)}` : ""}
${trigger.action === "ENTER" || trigger.action === "ADD" ? "If they declined this same buy and nothing they named has changed, say so and pass.\n" : ""}${HOUSE_RULES}
${digestSection}
═══════════════════════════════════════════════════════════════════
CURRENT TRIGGER LADDER (your standing game plan on $${thesis.ticker})
═══════════════════════════════════════════════════════════════════
${
  thesis.allTriggers.length
    ? thesis.allTriggers
        .map(
          (t) =>
            `  ${t.id === trigger.id ? "→ FIRED:" : coFiredIds.has(t.id) ? "→ ALSO FIRED:" : "  ·"} ${sentenceOf(t, position != null)}  [id ${t.id}]`,
        )
        .join("\n")
    : "  (no triggers on record — this thesis is unprotected; fix that in your close-out)"
}

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
   - Pull fresh data with get_stock_data($${thesis.ticker}).
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
     tracking): on a stock we watch, use update_thesis(change_status:
     "INVALIDATED") instead of REVIEWED. Durable kill — no future trigger
     fires, no future busywork. The user can re-add the name later if
     conditions change. A stock we hold is sold first with close_position,
     which retires the thesis itself. Don't leave dead theses on the book.

4. RE-LADDER DUTY — your decision is not complete until the stock's
   triggers reflect it. After an add, raise the floor (a bigger position
   must never round-trip into a loss). After a fired gain checkpoint,
   replace it with the next milestone. After a move that blew through a
   level, re-set it off the NEW structure the chart gives (the swing low,
   the breakout level, the average) using THE SETUP block's Manage line —
   not a round number. The stock's own exits from its setup (the partial,
   the beat-that-sold review) were written at the fill; the trail is
   your analyst's rule and applies on its own.
   The trigger ids are in the ladder printed above. If nothing went stale,
   say so in one sentence in the rationale ("Floor stays $X, still under
   the last swing low.").

5. Output discipline:
   - At most ONE trade tool call (place_trade / manage_position / close_position).
   - Always EXACTLY one update_thesis call documenting what you did and why.
     Pass trigger_id="${trigger.id}" so the timeline carries the link.
   - When WHAT'S BEEN SAID lists the principal's decisions or other triggers
     fired since the last answer, your update_thesis answers them too: say
     what you decided on each, by name.
   - Then complete_run.

═══════════════════════════════════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════════════════════════════════

  - 15 step max. Be ruthlessly concise.
  - You are NOT reviewing your other theses. Only $${thesis.ticker} matters
    on this run.
`;
}
