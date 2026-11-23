/**
 * The request when a trigger fires (the 5-min check in trigger-evaluator.ts,
 * run by tactical-run.ts): one stock, one trigger. A trigger set to Send to
 * Agent wakes the trigger run, which decides (lib/agent/engine/agents/trigger-run.ts);
 * one set to Auto has made its trade, and the post-trade write-up writes the
 * note on it (lib/agent/engine/agents/post-trade-writeup.ts). Both read the
 * same stock the same way (lib/agent/context/, for the thesis); this file
 * writes the message from the trigger check, the fire.
 */

import type { Trigger } from "@/lib/agent/triggers/types";
import type { AnalystCapacity } from "@/lib/agent/capacity";
import { analystBrief, type BriefAnalyst } from "@/lib/agent/analyst-brief";
import { isGroup, sentenceOf, shapeOf, trimPctOf } from "@/lib/agent/triggers/condition";
import { guidanceCodes, type SituationCode } from "@/lib/agent/situations";
import { guidanceFor } from "@/lib/agent/situation-skills";
import { situationsText } from "@/lib/agent/context/situations";
import { rowForModel } from "@/lib/agent/row-for-model";
import { writtenNote } from "@/lib/agent/triggers/note";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import { TRIGGER_RUN, TRIGGER_RUN_ASK } from "@/lib/agent/engine/agents/trigger-run";
import { POST_TRADE_WRITEUP, WRITEUP_ASK } from "@/lib/agent/engine/agents/post-trade-writeup";
import type { AgentRecord, BuiltRequest } from "@/lib/agent/engine/types";

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
  /** The trigger was set to Auto and the trade is made: what it was, in one sentence. The post-trade write-up writes it up. */
  autoTrade?: { line: string } | null;
  /** The Market and portfolio block's parts (lib/agent/portfolio-block.ts). Null: none. */
  portfolioPieces?: PortfolioPiece[] | null;
  /** The stock's own playbook in full (lib/agent/context/playbooks.ts); each of the analyst's when it has none. Null: none. */
  playbooks?: string | null;
  /** The analyst's account: paper or live. */
  environment?: "PAPER" | "LIVE";
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
  const short = rowForModel(row);
  return {
    row: notes?.length ? { ...short, notes_to_the_account: notes } : short,
    // The list names every situation; the guidance leaves out the ones only the morning run can answer.
    situations: { codes: guidanceCodes(status, codes), guidance: guidanceFor(guidanceCodes(status, codes, "INTRADAY_TACTICAL").map((code) => ({ code, held: status === "HOLDING" }))) },
  };
}

/** What the fire's message says: the stock, the trigger and its price, the position's tracked high, an Auto trade. */
type FireArgs = Pick<TacticalPromptArgs, "stock" | "trigger" | "position" | "fired" | "autoTrade">;

/**
 * On a give-back off the high since we bought, the tracked high and the line:
 * part of the fire's message.
 */
function trailingPeakText(args: FireArgs): string {
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

/** The stock's row, under its heading: the read "the_stock", for every agent given the stock. */
export function stockRowText(stock: Pick<TacticalPromptArgs["stock"], "ticker" | "row">): string {
  return `## $${stock.ticker}, its row (get_theses)
${stock.row ? JSON.stringify(stock.row, null, 2) : `(not read on this pass: get_theses(tickers: ["${stock.ticker}"]))`}`;
}

/**
 * What the trigger check knows about the fire beyond the trigger and its
 * price, written by tactical-run.ts: a report's numbers, a pre-catalyst
 * buy's window, what fired with it, a refused call on the stock. Each starts
 * with a space; "" when there is nothing more.
 */
export interface FireFacts {
  more: string;
}

/**
 * The message from the trigger check: the fire, said once. The trigger's
 * sentence, its price, its id and its declared action (the instructions act
 * on it); its note is on the stock's row beside its id, so it is said here
 * only when the row couldn't be read. Then the ask.
 */
export function fireMessage(args: FireArgs, facts: FireFacts): string {
  const { stock, trigger } = args;
  const price = args.fired?.price ?? null;
  const by = trigger.source === "PRINCIPAL" ? ", which the principal wrote" : "";
  const note = !stock.row && writtenNote(trigger) ? ` Its note: "${writtenNote(trigger)}"` : "";
  const action = trigger.action === "TRIM" ? `TRIM ${trimPctOf(trigger)}% of the position` : trigger.action;
  const fired = `"${sentenceOf(trigger)}" fired${price != null ? ` at $${price.toFixed(2)}` : ""} (trigger ${trigger.id}${by}; declared action: ${action}).${note}`;
  const auto = args.autoTrade ?? null;
  const head = auto
    ? `Write-up on $${stock.ticker}. ${fired} It is set to Auto, so no analyst decided. ${auto.line}${facts.more}`
    : `Tactical run on $${stock.ticker}. ${fired}${facts.more}`;
  const peak = trailingPeakText(args).trim();
  return [head, ...(peak ? [peak] : []), auto ? WRITEUP_ASK : TRIGGER_RUN_ASK].join("\n\n");
}

/**
 * The request when a trigger fires, from what a replay or a test has in
 * hand, written as the loaders write it (lib/agent/context/; a live fire's
 * are read for its thesis in tactical-run.ts): the trigger run's record, or
 * on an Auto trade the post-trade write-up's. Its context is the stock and
 * the market numbers; its message the fire.
 */
export function triggerRunRequest(args: TacticalPromptArgs, facts: FireFacts = { more: "" }, now: Date = new Date()): BuiltRequest {
  return composeAgentRequest(recordFor(args), { now, environment: args.environment ?? "PAPER", message: fireMessage(args, facts) }, {
    pieces: args.portfolioPieces ?? null,
    context: {
      the_analyst: analystBrief(args.analyst, args.capacity),
      the_playbook: args.playbooks || null,
      situations: situationsText(args.stock.ticker, args.situations),
      the_stock: stockRowText(args.stock),
    },
  });
}

/** The agent a fire wakes: the post-trade write-up when an Auto trigger made its trade, else the trigger run. */
export function recordFor(args: { autoTrade?: { line: string } | null }): AgentRecord {
  return args.autoTrade ? POST_TRADE_WRITEUP : TRIGGER_RUN;
}
