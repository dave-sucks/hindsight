/**
 * The yardstick's grades (docs/plans/AGENT_ENGINE.md, "The yardstick"): what
 * one replayed agent decision is scored on, by code, so a change to an agent
 * is judged on the same list before and after. Pure functions over the
 * agent's tool calls and text and the text it was given; the case runner
 * (scripts/hero-case.ts --grade) calls them.
 *
 * - The right playbook: the case names the acceptable ones ("none" for no
 *   playbook).
 * - Prices from what it was shown: every price it sets sits within 1% of a
 *   dollar figure in its inputs (the chart's levels, the gap-day lows).
 * - Nothing invented: every number it writes appears in its inputs, within
 *   1% (a replay has no web search, so a number from nowhere is invented).
 * - A belief someone can check: no stock price in the belief; two to four
 *   assumptions, each with a number and when it is checked; what would prove
 *   it wrong names the business, never a price, an average or a gap.
 * - The sale price never loosened: no edit lowers a "Sell if below" price,
 *   and none removes one.
 */

export interface GradedCall {
  toolName: string;
  input: unknown;
}

export interface Grades {
  /** The playbook named ("none" when none), and whether the case accepts it; null when the case names none. */
  playbook: { named: string; right: boolean } | null;
  /** Every price it set, and the ones not within 1% of a dollar figure it was shown. */
  prices: { set: number; offInputs: number[] };
  /** Numbers it wrote that appear nowhere in its inputs. */
  invented: string[];
  /** On a thesis it wrote: what makes its belief hard to check; null when it wrote none. */
  belief: { problems: string[] } | null;
  /** Sale prices it lowered or removed, by trigger id. */
  saleLoosened: string[];
}

const NUMBER = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.01);
const num = (token: string) => Number(token.replace(/[$,%]/g, ""));

/** Every number in a text, as written. */
export function numbersIn(text: string): string[] {
  return text.match(NUMBER) ?? [];
}

/** The dollar figures in a text. */
export function dollarsIn(text: string): number[] {
  return (text.match(/\$\d[\d,]*(?:\.\d+)?/g) ?? []).map(num).filter(Number.isFinite);
}

/** Numbers worth checking: a dollar figure, a percent, or any number of 10 or more that isn't a year. */
function checkable(token: string): boolean {
  const n = num(token);
  if (!Number.isFinite(n)) return false;
  if (token.startsWith("$") || token.endsWith("%")) return true;
  if (n >= 2000 && n <= 2035 && Number.isInteger(n)) return false;
  return n >= 10;
}

/**
 * The numbers it wrote that its inputs don't have. A percent counts as shown
 * when it is the move between two dollar figures it was shown ("2.5% over
 * the 50-day"): worked out from the data, not invented.
 */
export function inventedNumbers(written: string, inputs: string): string[] {
  const known = numbersIn(inputs).map(num).filter(Number.isFinite);
  const dollars = [...new Set(dollarsIn(inputs))].filter((d) => d > 0);
  const between = (pct: number) => dollars.some((a) => dollars.some((b) => a !== b && Math.abs(Math.abs(a / b - 1) * 100 - pct) <= 0.15));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of numbersIn(written)) {
    if (!checkable(token) || seen.has(token)) continue;
    seen.add(token);
    if (known.some((k) => close(num(token), k))) continue;
    if (token.endsWith("%") && between(num(token))) continue;
    out.push(token);
  }
  return out;
}

const input = (c: GradedCall) => (c.input ?? {}) as Record<string, unknown>;
const list = (x: unknown): Array<Record<string, unknown>> => (Array.isArray(x) ? (x as Array<Record<string, unknown>>) : []);

/** Every price a call sets: a price trigger's value, an edited value, a buy's price and sale price. */
export function pricesSet(calls: GradedCall[]): number[] {
  const out: number[] = [];
  for (const c of calls) {
    const a = input(c);
    for (const t of [...list(a.triggers), ...list(a.add_triggers)]) {
      const p = (t.predicate ?? t.condition ?? {}) as Record<string, unknown>;
      if (p.watch === "price" && typeof p.value === "number") out.push(p.value);
    }
    for (const e of list(a.edit_triggers)) if (typeof e.value === "number" && (e.watch == null || e.watch === "price")) out.push(e.value);
    for (const k of ["entry_price", "sell_if_below"]) if (typeof a[k] === "number") out.push(a[k] as number);
  }
  return out;
}

/**
 * The stock prices a text names: a bare dollar figure ("$72.40", "below $80").
 * A business figure is not one: a size ("$200M", "$1.3B", "$11.6 billion") or
 * a per-share number ("EPS of $1.10", "a $0.25 dividend").
 */
export function stockPricesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$\d[\d,]*(?:\.\d+)?/g)) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 12);
    const before = text.slice(Math.max(0, m.index! - 30), m.index!);
    if (/^\s*(?:[MBKT]\b|mm\b|bn\b|million|billion|thousand|trillion)/i.test(after)) continue;
    if (/(EPS|per share|earnings per|dividend|a share)\b[^.$]*$/i.test(before) || /^\s*(?:a|per) share/i.test(after)) continue;
    out.push(m[0]);
  }
  return out;
}

/** The fields of a thesis it wrote that make the belief hard to check. */
export function beliefProblems(thesis: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const belief = String(thesis.core_belief ?? "");
  if (stockPricesIn(belief).length) problems.push("the belief names a price");
  if (/price target|within \d+ (days|weeks)/i.test(belief)) problems.push("the belief names a target or a time to a price");
  const assumptions = Array.isArray(thesis.key_assumptions) ? (thesis.key_assumptions as unknown[]).map(String) : [];
  if (assumptions.length < 2 || assumptions.length > 4) problems.push(`${assumptions.length} assumptions (two to four)`);
  for (const a of assumptions) {
    if (!/\d/.test(a)) problems.push(`an assumption with no number: "${a.slice(0, 80)}"`);
    if (!/(check|report|quarter|Q[1-4]|10-[QK]|earnings|guidance|call|20\d\d|january|february|march|april|may|june|july|august|september|october|november|december)/i.test(a)) problems.push(`an assumption with no point it is checked at: "${a.slice(0, 80)}"`);
  }
  const wrong = Array.isArray(thesis.invalidation_conditions) ? (thesis.invalidation_conditions as unknown[]).map(String) : [];
  for (const w of wrong) if (stockPricesIn(w).length || /\d+-day|moving average|52-week|gap-day|\bgap\b|clos(?:e|es|ed|ing) (below|above|under|over)|trades? (below|above|under|over)/i.test(w)) problems.push(`proof it's wrong reads a price: "${w.slice(0, 80)}"`);
  return problems;
}

/** The sale prices it lowered or removed: `before` is each "Sell if below" trigger's price by id. */
export function saleLoosened(calls: GradedCall[], before: Map<string, number>): string[] {
  const out: string[] = [];
  for (const c of calls) {
    const a = input(c);
    for (const e of list(a.edit_triggers)) {
      const id = String(e.id ?? "");
      const was = before.get(id);
      if (was != null && typeof e.value === "number" && e.value < was - 1e-6) out.push(`${id}: $${was} → $${e.value}`);
    }
    for (const id of Array.isArray(a.remove_trigger_ids) ? (a.remove_trigger_ids as unknown[]).map(String) : []) if (before.has(id)) out.push(`${id}: removed`);
  }
  return out;
}

/** The "Sell if below" prices in its inputs, by trigger id: the row's lines ("Sell if below $280 … [id x]") and a thesis's stored triggers. */
export function salePricesShown(inputs: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of inputs.matchAll(/Sell if below \$([\d,.]+)[^\]\n]*?\[id ([\w-]+)\]/g)) out.set(m[2], num(m[1]));
  for (const m of inputs.matchAll(/"id":\s*"([\w-]+)"[^{}]*?"action":\s*"EXIT"[^{}]*?"predicate":\s*\{[^{}]*?"is":\s*"below"[^{}]*?"value":\s*([\d.]+)/g)) out.set(m[1], Number(m[2]));
  for (const m of inputs.matchAll(/- ([\w-]+): Sell if below \$([\d,.]+)/g)) out.set(m[1], num(m[2]));
  return out;
}

/**
 * What it states as fact for the owner or the next agent: notes, reasons, the
 * belief, its narration. Not its assumptions or what would prove it wrong:
 * the numbers there are bars it sets ("revenue stays above $230M"), its call
 * to make, not facts it claims.
 */
export function writtenText(calls: GradedCall[], narration: string): string {
  const parts = [narration];
  for (const c of calls) {
    const a = input(c);
    for (const k of ["rationale", "entry_rationale", "sell_reason", "notes", "reason", "core_belief", "conviction_rationale", "company"]) if (typeof a[k] === "string") parts.push(a[k] as string);
    for (const t of [...list(a.triggers), ...list(a.add_triggers), ...list(a.edit_triggers)]) if (typeof t.rationale === "string") parts.push(t.rationale);
  }
  return parts.join("\n");
}

/** Grade one run: its calls and narration against the inputs it was given and the case's labels. */
export function grade(run: { calls: GradedCall[]; narration: string }, inputs: string, labels: { playbooks?: string[] }): Grades {
  const thesis = run.calls.find((c) => c.toolName === "submit_thesis");
  const named = thesis ? String(input(thesis).setup_id ?? "none") : null;
  const shown = dollarsIn(inputs);
  const prices = pricesSet(run.calls);
  return {
    playbook: labels.playbooks && named != null ? { named, right: labels.playbooks.includes(named) } : null,
    prices: { set: prices.length, offInputs: prices.filter((p) => !shown.some((s) => close(p, s))) },
    invented: inventedNumbers(writtenText(run.calls, run.narration), inputs),
    belief: thesis ? { problems: beliefProblems(input(thesis)) } : null,
    saleLoosened: saleLoosened(run.calls, salePricesShown(inputs)),
  };
}
