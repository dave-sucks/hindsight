/**
 * The words: one sentence and one pill per condition, read from the shape.
 *
 * The dialog's sentence, the pill on the sheet and (from PR 3) the Activity
 * line and the agent's fire payload all come from here, so a trigger reads the
 * same everywhere. docs/plans/TRIGGER_TYPES.md §6.
 *
 * Pure and client-safe.
 */

import type { Condition, When } from "./types";
import { conditionsOf, isGroup } from "./types";
import { variableDef } from "./variables";

const WHEN_CLOSE: Record<string, string> = { prev_close: "today", close_5d: "this week", close_20d: "this month" };
const WINDOW_WORDS: Record<string, string> = { "1M": "1 month", "3M": "3 months", "6M": "6 months" };

export function money(n: number): string {
  return `$${n % 1 === 0 ? n : n.toFixed(2)}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function everyWords(c: Condition): string {
  const n = c.value ?? 0;
  const unit = c.params?.every ?? "days";
  const word = unit === "weeks" ? plural(n, "week", "weeks") : unit === "months" ? plural(n, "month", "months") : plural(n, "day", "days");
  return n === 1 ? `every ${word}` : `every ${n} ${word}`;
}

/** One condition as a clause: "the price falls below $248". `inGroup` words a schedule as a state. */
export function conditionSentence(c: Condition, opts: { inGroup?: boolean } = {}): string {
  const v = c.value ?? 0;
  const p = c.params ?? {};
  const close = p.onClose === true;
  const words = c.variable ? variableDef(c.variable).words : "";
  switch (c.watch) {
    case "price": {
      if (c.unit !== "%") {
        const verb = close ? "closes" : c.is === "above" ? "rises" : "falls";
        return `the price ${verb} ${c.is === "above" ? "above" : "below"} ${c.variable ? words : money(v)}`;
      }
      const is = close ? "closes" : "is";
      let s: string;
      if (c.is === "near") s = `the price ${is} within ${pct(v)} of ${words}`;
      else if (c.variable && WHEN_CLOSE[c.variable]) s = `the price ${is} ${c.is === "above" ? "up" : "down"} ${pct(v)} ${WHEN_CLOSE[c.variable]}`;
      else if (c.variable === "entry" || c.variable === "peak") s = `the price ${is} ${c.is === "above" ? "up" : "down"} ${pct(v)} from ${words}`;
      else s = `the price ${is} ${pct(v)} ${c.is === "above" ? "above" : "below"} ${words}`;
      if (p.startOnceUpPct != null) s += `, once it has been up ${pct(p.startOnceUpPct)}`;
      if (p.widenAtr != null) s += ` (or ${p.widenAtr}× its daily range, if wider)`;
      if (p.fastWinner) {
        s += ` (not if it ran up ${pct(p.fastWinner.gainPct)}${p.fastWinner.withinDays != null ? ` within ${p.fastWinner.withinDays} days` : ""})`;
      }
      return s;
    }
    case "volume":
      return `volume is ${c.is === "above" ? "above" : "below"} ${v}× a normal day${close ? " at the close" : ""}`;
    case "rsi":
      return `the ${p.period ?? 14}-day RSI is ${c.is === "above" ? "above" : "below"} ${v}`;
    case "strength": {
      const w = WINDOW_WORDS[p.window ?? "3M"];
      if (c.is === "above") {
        if (v === 0) return `it is beating the S&P over ${w}`;
        return v > 0 ? `it is beating the S&P by more than ${v} points over ${w}` : `it is no more than ${-v} points behind the S&P over ${w}`;
      }
      if (v === 0) return `it is trailing the S&P over ${w}`;
      return v < 0 ? `it is more than ${-v} points behind the S&P over ${w}` : `it is less than ${v} points ahead of the S&P over ${w}`;
    }
    case "gap":
      return `it gapped up ${pct(v)} or more on ${p.volume ?? 3}× volume in the last ${p.withinDays ?? 1} ${plural(p.withinDays ?? 1, "day", "days")}`;
    case "report":
      if (c.is === "before") return `earnings are ${v} ${plural(v, "day", "days")} away or less`;
      return `it is within ${v} ${plural(v, "day", "days")} after earnings${p.fromDay === 1 ? ", counting from the day after" : ""}`;
    case "surprise":
      return `earnings ${c.is === "beat" ? "beat" : "miss"} the estimate${v > 0 ? ` by ${pct(v)} or more` : ""}`;
    case "filing":
      if (c.variable) return `the company files ${words}`;
      return c.is === "red_flag" ? "the company files a red-flag filing with the SEC" : "the company files something material with the SEC";
    case "insiders":
      return `${v} or more insiders buy within ${p.days ?? 30} days`;
    case "schedule":
      if (c.is === "every") return opts.inGroup ? `a review is due (${everyWords(c)})` : everyWords(c);
      if (c.variable === "buy") return opts.inGroup ? `it has been ${v} days since the buy` : `${v} days after the buy`;
      if (c.is === "before") return opts.inGroup ? `the event date is ${v} days away or less` : `${v} days before the event date`;
      return opts.inGroup ? `it is ${v} days past the event date` : `${v} days after the event date`;
  }
}

export function whenSentence(w: When): string {
  if (!isGroup(w)) return conditionSentence(w, { inGroup: true });
  return w.conditions.map(whenSentence).join(w.match === "all" ? " and " : " or ");
}

/** The verb a trigger's action reads as. A sale on a stock we don't own takes the plan down. */
export function actionVerb(action: string, held?: boolean): string {
  switch (action) {
    case "ENTER":
      return "Buy";
    case "ADD":
      return "Add";
    case "TRIM":
      return "Trim";
    case "EXIT":
      return held === false ? "Take the plan down" : "Sell";
    case "MOVE_STOP":
      return "Move the stop";
    default:
      return "Review";
  }
}

/** The whole trigger as one sentence: "Sell when the price falls below $248." */
export function triggerSentence(action: string, w: When, held?: boolean): string {
  const verb = actionVerb(action, held);
  if (!isGroup(w) && w.watch === "schedule") return `${verb} ${conditionSentence(w)}.`;
  return `${verb} when ${whenSentence(w)}.`;
}

export interface PillPart {
  /** The muted half: "below", "down from the high", "every". */
  label: string;
  /** The value half: "$248", "25%", "30 days". */
  value?: string;
  /** A variable, drawn as a chip instead of a plain value. */
  chip?: string;
}

export function pillPart(c: Condition): PillPart {
  const v = c.value ?? 0;
  const p = c.params ?? {};
  const chip = c.variable ? variableDef(c.variable).chip : undefined;
  switch (c.watch) {
    case "price": {
      if (c.unit !== "%") {
        const label = `${p.onClose ? "closes " : ""}${c.is === "above" ? "above" : "below"}`;
        return c.variable ? { label, chip } : { label, value: money(v) };
      }
      if (c.is === "near") return { label: `within ${pct(v)} of`, chip };
      if (c.variable && WHEN_CLOSE[c.variable]) return { label: `${c.is === "above" ? "up" : "down"} ${WHEN_CLOSE[c.variable]}`, value: pct(v) };
      if (c.variable === "entry") return { label: `${c.is === "above" ? "up" : "down"} from entry`, value: pct(v) };
      if (c.variable === "peak") return { label: "down from the high", value: pct(v) };
      return { label: `${pct(v)} ${c.is === "above" ? "above" : "below"}`, chip };
    }
    case "volume":
      return { label: `volume ${c.is === "above" ? "above" : "below"}`, value: `${v}×` };
    case "rsi":
      return { label: `RSI ${p.period ?? 14} ${c.is === "above" ? "above" : "below"}`, value: String(v) };
    case "strength":
      return { label: `vs. S&P ${p.window ?? "3M"} ${c.is === "above" ? "above" : "below"}`, value: `${v} pts` };
    case "gap":
      return { label: "gap up", value: `${pct(v)}+` };
    case "report":
      return { label: c.is === "before" ? "before earnings" : "after earnings", value: `${v} ${plural(v, "day", "days")}` };
    case "surprise":
      return { label: `earnings ${c.is === "beat" ? "beat" : "miss"}`, value: v > 0 ? `${pct(v)}+` : undefined };
    case "filing":
      return chip ? { label: "SEC filing", chip } : { label: "SEC filing", value: c.is === "red_flag" ? "red flag" : "material" };
    case "insiders":
      return { label: "insiders buying", value: `${v}+ in ${p.days ?? 30}d` };
    case "schedule":
      if (c.is === "every") return { label: "every", value: everyWords(c).replace(/^every /, "") || "day" };
      return { label: `${v} days ${c.is === "before" ? "before" : "after"}`, chip };
  }
}

/** A trigger's pill: one part per condition, with "and" / "or" between them. */
export function pillParts(w: When): { parts: PillPart[]; joiner: "and" | "or" } {
  return { parts: conditionsOf(w).map(pillPart), joiner: isGroup(w) && w.match === "any" ? "or" : "and" };
}
