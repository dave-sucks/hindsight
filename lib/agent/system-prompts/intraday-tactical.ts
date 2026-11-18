/**
 * Intraday Tactical system prompt.
 *
 * Spawned when a structured trigger fires (the 5-min cron in
 * trigger-evaluator.ts). Single-thesis, single-decision scope. The
 * agent's job: find out what is going on with the company and the stock,
 * decide (the declared action, another, or nothing), and write the review
 * the owner and the next run read. When the trigger was set to Auto, the
 * trade is already made and the job is the write-up alone (`autoTrade`):
 * the same stock, the same read, no trade tools.
 *
 * Why a separate prompt: the daily run prompt is about walking the
 * book and deciding per-thesis. The tactical prompt is about ONE
 * (thesis, trigger, quote) tuple — the budget, scope, and
 * tool path are all narrower.
 */

import type { Trigger } from "@/lib/agent/triggers/types";
import type { AnalystCapacity } from "@/lib/agent/capacity";
import { analystBrief, type BriefAnalyst } from "@/lib/agent/analyst-brief";
import { conditionSentence, isGroup, shapeOf, trimPctOf } from "@/lib/agent/triggers/condition";
import { SITUATIONS, guidanceCodes, guidanceFor, type SituationCode } from "@/lib/agent/situations";
import { rowForModel } from "@/lib/agent/row-for-model";
import { writtenNote } from "@/lib/agent/triggers/note";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import { TRIGGER_RUN, type TriggerRunExtra } from "@/lib/agent/engine/agents/trigger-run";
import type { BuiltRequest } from "@/lib/agent/engine/types";

/** The tools a write-up of an Auto trade is not given: the trade is made, and this run only writes. */
export const NOT_IN_A_WRITEUP: ReadonlySet<string> = new Set(["place_trade", "close_position", "manage_position", "dispatch_thesis_research", "wait_for_thesis_refresh"]);

/** What the write-up of an Auto trade asks: its text is the record's (lib/agent/engine/agents/trigger-run.ts). */
export { AUTO_WRITEUP } from "@/lib/agent/engine/agents/trigger-run";

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
     * Position.peakPrice — the five-minute check's watermark (high for
     * LONG, low for SHORT) covering the position's whole life. DAV-186:
     * surfaced so trail-fire validation checks arithmetic against THIS
     * number instead of re-deriving a "peak" from a short chart window.
     * Null on legacy callers / rows the check hasn't stamped yet.
     */
    peakPrice?: number | null;
  } | null;
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
  /** The trigger was set to Auto and the trade is made: what it was, in one sentence. The run writes it up. */
  autoTrade?: { line: string } | null;
  /** The Market and portfolio block's parts (lib/agent/portfolio-block.ts). Null: none. */
  portfolioPieces?: PortfolioPiece[] | null;
  /** A review fired on a stock we only watch: the analyst's playbooks, the Writer's block (playbooksBlock); REVIEW_DUE says what to do with them. Null: none. */
  playbooks?: string | null;
}

/**
 * The trigger run's stock, from its get_theses read (step 10): the short row
 * every door reads, with what its playbook's buy checks (`playbook_checks`), and the
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
  // The notes every run reads once at the top (the account's and the
  // analyst's, lib/agent/shared-notes.ts) ride on the one row this run prints.
  const notes = (read?.data as { notes?: string[] } | undefined)?.notes;
  const short = rowForModel(row, { named: true, size: "short", playbookChecks: true }) as Record<string, unknown>;
  return {
    row: notes?.length ? { ...short, notes_to_the_account: notes } : short,
    // The list names every situation; the guidance leaves out the ones only the morning run can answer.
    situations: { codes: guidanceCodes(status, codes), guidance: guidanceFor(guidanceCodes(status, codes, "INTRADAY_TACTICAL"), "INTRADAY_TACTICAL") },
  };
}

/** The run's facts its words need (the record's TriggerRunExtra), from the prompt's args. */
function extraOf(args: TacticalPromptArgs): TriggerRunExtra {
  const { stock, trigger, fired } = args;
  const auto = args.autoTrade ?? null;
  return {
    ticker: stock.ticker,
    auto: auto != null,
    autoLine: auto?.line ?? "",
    predicateSummary: conditionSentence(trigger.predicate),
    action: trigger.action,
    triggerId: trigger.id,
    firedPrice: fired?.price ?? null,
    hasPlaybooks: Boolean(args.playbooks),
    declineLine: !auto && (trigger.action === "ENTER" || trigger.action === "ADD"),
  };
}

/**
 * On a give-back off the high since we bought, the tracked high and the line:
 * part of the fired_trigger block.
 */
function trailingPeakText(args: TacticalPromptArgs): string {
  const { stock, trigger, position } = args;
  const auto = args.autoTrade ?? null;
    // A give-back off the high since we bought. An Auto trade is made: there is no fire to check.
  if (auto) return "";
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
  }, recorded every five minutes over the position's ENTIRE life.
  ${
  threshold != null
    ? `The fire line is $${threshold.toFixed(2)} (${pct}% ${isShort ? "above the low" : "below the peak"}). Checking this fire means ONE arithmetic check: is the current price ${isShort ? "at or above" : "at or below"} $${threshold.toFixed(2)}?`
    : `Checking this fire means one arithmetic check against that tracked watermark — if it is missing from this prompt, treat the evaluator's fire as correct rather than reconstructing a peak yourself.`
  }
  Any "recent high" you compute from a chart window has shorter memory than
  the watermark, understates the give-back, and is NOT valid grounds to
  declare a false alarm. Declining this exit requires new fundamental
  evidence — not a different peak.`;
}

/** What fired: the fired_trigger block. */
function firedTriggerText(args: TacticalPromptArgs): string {
  const { trigger } = args;
  const predicateSummary = conditionSentence(trigger.predicate);
  return `═══════════════════════════════════════════════════════════════════
TRIGGER THAT FIRED (id: ${trigger.id})
═══════════════════════════════════════════════════════════════════
  predicate: ${predicateSummary}
  declared action: ${trigger.action === "TRIM" ? `TRIM ${trimPctOf(trigger)}% of the position` : trigger.action}${writtenNote(trigger) ? `\n  ${trigger.source === "PRINCIPAL" ? "the principal's note on it" : "its note"}: "${writtenNote(trigger)}"` : ""}${trailingPeakText(args)}`;
}

/** The stock's row, under its heading: the stock_row block. */
function stockRowText(stock: TacticalPromptArgs["stock"]): string {
  return `═══════════════════════════════════════════════════════════════════
$${stock.ticker}, its row (get_theses)
═══════════════════════════════════════════════════════════════════
${stock.row ? JSON.stringify(stock.row, null, 2) : `(not read on this pass: get_theses(tickers: ["${stock.ticker}"]))`}`;
}

/** The situations the stock is in and what each asks, printed inside the decision framework: the situations block. */
function situationsText(args: TacticalPromptArgs): string {
  const { stock } = args;
  const guidance = Object.entries(args.situations?.guidance ?? {}) as Array<[SituationCode, string]>;
  return guidance.length
    ? `   - The situations $${stock.ticker} is in (${(args.situations?.codes ?? []).join(", ")}), and what each asks:\n\n` +
      guidance.map(([code, text]) => `${code} — ${SITUATIONS[code].name}\n${text}`).join("\n\n") +
      "\n\n"
    : "";
}

/** The kickoff's facts (tactical-run.ts writes them): the fire_facts block. */
export interface TriggerRunKickoff {
  facts: string;
}

/**
 * The trigger run's request, built by the agent engine from its record
 * (lib/agent/engine/agents/trigger-run.ts): its instructions, and its first
 * message when the kickoff's facts are given.
 */
export function triggerRunRequest(args: TacticalPromptArgs, kickoff?: TriggerRunKickoff): BuiltRequest {
  const auto = args.autoTrade ?? null;
  // The Market and portfolio block goes in before the stock's row, so the
  // row is read after it. On 2026-10-07 a day-old digest told the trigger
  // runs "no pending proposals" while ASML's row carried its sale awaiting
  // approval: the block's snapshot is written when this request is built,
  // and the house rules say the stock's row wins where they differ.
  return composeAgentRequest(TRIGGER_RUN, { now: new Date(), environment: "PAPER", extra: extraOf(args) }, {
    pieces: args.portfolioPieces ?? null,
    blocks: {
      analyst_brief: analystBrief(args.analyst, args.capacity),
      stock_row: stockRowText(args.stock),
      playbooks: args.playbooks || null,
      fired_trigger: firedTriggerText(args),
      // A write-up reads its own text (AUTO_WRITEUP), not a situation's.
      situations: auto ? null : situationsText(args),
      fire_facts: kickoff ? kickoff.facts : null,
    },
  });
}

/** The trigger run's instructions alone (triggerRunRequest). */
export function buildTacticalSystemPrompt(args: TacticalPromptArgs): string {
  return triggerRunRequest(args).instructions;
}
