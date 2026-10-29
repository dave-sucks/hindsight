/**
 * stock-context.ts — what an agent is handed about one stock before it
 * decides (docs/plans/AGENT_CONTEXT.md §3.2, §3.3). Everything counts from
 * the analyst's LAST ANSWER, the newest line a run wrote on the stock:
 *
 *  - that answer in full, and the two before it, so a run picks up the story;
 *  - the principal's decisions since it, word for word, with the price then
 *    and now (once answered, a decision is done);
 *  - every trigger fired since it, collapsed, with its rule.
 *
 * Nothing else. The first version also carried answered decisions, two of
 * the run's own answers and bookkeeping — ~650 tokens for CEG on 09-30, when
 * the run needed one line: the 15%-off-the-high review nobody had answered.
 *
 * A fire stays open until an agent answers it. A later fire, the principal's
 * edit or the app's bookkeeping does not close it: CEG's 15% review fired
 * twice and was never handed to a run (09-16 a later fire took its place;
 * 09-28 the principal's cleanup counted as its answer). get_theses, the
 * trigger run, complete_run and the thesis sheet all use this rule.
 *
 * The principal's newest notes (notes.ts) come first. A note is information:
 * never an answer, never a plan change, and nothing closes it. Under them,
 * the triggers the principal removed by hand, at any age, under one header
 * that says what they ask: an answer does not close a removal either
 * (ABT 10-07: a run never read the removal and set the buy again).
 *
 * Pure: needs-action.ts imports it; trigger labels come from the caller.
 */

/** One Activity line, as the callers load it. Any order. */
export interface ActivityRow {
  id?: string;
  type: string;
  timestamp: Date;
  triggerId?: string | null;
  summary?: string | null;
  rationale?: string | null;
  fieldChanges?: unknown;
  /** Set when a run wrote the line; null for the principal and the app's bookkeeping. */
  runId?: string | null;
  runMode?: string | null;
  priceAtTime?: number | null;
}

/** A trigger fired since the last agent answer. */
export interface OpenFire {
  triggerId: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
  lastPrice: number | null;
  /** The newest fire line's summary — the label when the trigger is gone. */
  summary: string | null;
}

export interface PrincipalDecision {
  at: Date;
  line: string;
  /** Unanswered, it puts the stock on the morning run's full list. A bare decline doesn't. */
  wantsAnswer: boolean;
}

export interface TriggerLabel {
  label: string;
  rationale?: string | null;
}

export interface StockContext {
  /** The block, ready to print; null when there is nothing on record. */
  text: string | null;
  openFires: OpenFire[];
  unansweredDecision: PrincipalDecision | null;
  /** The principal's newest note, one line — what a quiet row carries. */
  principalNote: string | null;
}

/** ~400 tokens of alerts. Past it, alerts fold into a count; the notes above them are never cut. */
export const CONTEXT_CHAR_CAP = 1_600;
/** Rules: whole sentences up to this many characters. */
const SENTENCE_CHARS = 220;
/** The analysts' notes a run is handed: the newest, then the two before it. */
export const ANSWERS_SHOWN = 3;
const LAST_NOTE_CHARS = 900;
const EARLIER_NOTE_CHARS = 500;

type Changes = {
  source?: { to?: unknown };
  triggerOps?: { to?: Array<{ op?: string; text?: string }> };
  proposal?: { to?: { intent?: string; quantity?: number; proposedQuantity?: number; edited?: boolean; userMessage?: string } };
};
const changesOf = (r: ActivityRow): Changes =>
  r.fieldChanges && typeof r.fieldChanges === "object" ? (r.fieldChanges as Changes) : {};
const newestFirst = (rows: ActivityRow[]) => [...rows].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const money = (n: number) => `$${n.toFixed(2)}`;

/** A proposal decision, or an edit made by hand. */
export function isPrincipalRow(r: ActivityRow): boolean {
  if (r.type.startsWith("PROPOSAL_")) return true;
  if (r.runId) return false;
  return (r.rationale ?? "").startsWith("[USER]") || changesOf(r).source?.to === "USER";
}

/**
 * A line a run wrote: a review, an update, a status move, a close. Not a fire,
 * a proposal decision, the principal's edit, or the app's bookkeeping (those
 * carry no run).
 */
export function isAgentAnswer(r: ActivityRow): boolean {
  return !!r.runId && r.type !== "TRIGGER_FIRED" && r.type !== "NOTE" && !isPrincipalRow(r);
}

/**
 * The analysts' newest notes on a stock, newest first: what every run is
 * handed and what the stock's Recent section shows. Fires, proposal
 * decisions, the principal's edits and the app's bookkeeping are events, not
 * notes, and are left out.
 */
export function recentAnswers(rows: ActivityRow[]): ActivityRow[] {
  return newestFirst(rows).filter(isAgentAnswer).slice(0, ANSWERS_SHOWN);
}

/** How many of the principal's notes an agent is shown: the newest. */
export const NOTES_SHOWN = 3;

/** The principal's newest notes on the stock (lib/agent/notes.ts), newest first. */
export function newestNotes(rows: ActivityRow[]): ActivityRow[] {
  return newestFirst(rows).filter((r) => r.type === "NOTE").slice(0, NOTES_SHOWN);
}

/** The same ask, said once over the removals block. */
const REMOVALS_HEADER = "Removed by the principal (don't add these back unless the thesis changes):";

/**
 * How a removal in the cleanup of copied rules (scripts/sweep-frozen-copies.ts)
 * begins its summary; thesis-edit.ts writes it from here. Those removals took
 * template lines off stocks and decided nothing about a stock, so the read
 * leaves them out. The rows carry no other marker.
 */
export const COPIED_RULE_CLEANUP = "Removed a copied rule from ";

const isCopiedRuleCleanup = (r: ActivityRow) => (r.summary ?? "").startsWith(COPIED_RULE_CLEANUP);

/** How many of the principal's removals an agent is shown: the newest. */
export const REMOVALS_SHOWN = 3;

export interface RemovedTrigger {
  at: Date;
  /** The trigger as it read when it was removed: "Buy if below 6% from the close 5 days ago". */
  sentence: string;
}

/**
 * Every trigger the principal removed by hand, newest first, each sentence
 * once (its newest removal). The cleanup of copied rules is left out.
 */
export function removedByHand(rows: ActivityRow[]): RemovedTrigger[] {
  const out: RemovedTrigger[] = [];
  const seen = new Set<string>();
  for (const r of newestFirst(rows)) {
    if (!isPrincipalRow(r) || r.type.startsWith("PROPOSAL_") || isCopiedRuleCleanup(r)) continue;
    for (const o of changesOf(r).triggerOps?.to ?? []) {
      if (o?.op !== "remove") continue;
      const sentence = oneLine(o.text ?? "").replace(/^Removed:\s*/, "").replace(/\.$/, "");
      if (!sentence || seen.has(sentence.toLowerCase())) continue;
      seen.add(sentence.toLowerCase());
      out.push({ at: r.timestamp, sentence });
    }
  }
  return out;
}

/** Every trigger fired after the newest agent answer, newest first. */
export function openFires(rows: ActivityRow[]): OpenFire[] {
  const byTrigger = new Map<string, OpenFire>();
  for (const r of newestFirst(rows)) {
    if (isAgentAnswer(r)) break;
    if (r.type !== "TRIGGER_FIRED" || !r.triggerId) continue;
    const seen = byTrigger.get(r.triggerId);
    if (seen) {
      seen.count += 1;
      seen.firstAt = r.timestamp;
    } else {
      byTrigger.set(r.triggerId, {
        triggerId: r.triggerId,
        count: 1,
        firstAt: r.timestamp,
        lastAt: r.timestamp,
        lastPrice: typeof r.priceAtTime === "number" ? r.priceAtTime : null,
        summary: r.summary ?? null,
      });
    }
  }
  return [...byTrigger.values()];
}

/** Whole sentences up to `n` characters; a first sentence longer than that is cut at a word. */
function sentences(text: string, n = SENTENCE_CHARS): string {
  const parts = oneLine(text).split(/(?<=[.!?])\s+/);
  let out = "";
  for (const p of parts) {
    if ((out ? out.length + 1 : 0) + p.length > n) break;
    out = out ? `${out} ${p}` : p;
  }
  if (out) return out;
  const cut = parts[0].slice(0, n - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > n * 0.6 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

/** " at $273.98, now $264.60 (−3.4%)" — as much as the prices allow. */
function thenNow(then: number | null, now: number | null): string {
  if (then == null) return "";
  if (now == null || now <= 0) return ` at ${money(then)}`;
  const pct = ((now - then) / then) * 100;
  return ` at ${money(then)}, now ${money(now)} (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%)`;
}

const INTENT: Record<string, string> = { CLOSE: "the sale", PARTIAL_CLOSE: "the partial sale", OPEN: "the buy", ADD: "the add" };

/**
 * The principal's decision on one line, or null when there is nothing to
 * decide: a plain approval (the position shows it), an expiry, the cleanup
 * of copied rules.
 */
export function principalDecision(r: ActivityRow, priceThen: number | null = null, priceNow: number | null = null): PrincipalDecision | null {
  if (!isPrincipalRow(r)) return null;
  const at = thenNow(priceThen, priceNow);
  const to = changesOf(r).proposal?.to;
  const what = (to?.intent && INTENT[to.intent]) ?? "the proposal";
  const qty = to?.quantity != null ? ` (${to.quantity} shares)` : "";

  if (r.type === "PROPOSAL_REJECTED") {
    const raw = to?.userMessage ?? r.rationale ?? "";
    // A no-message decline stored a "[REJECTED:USER] …" line until 2026-10-29; it stores none now.
    const message = raw && !raw.startsWith("[REJECTED:USER]") ? oneLine(raw) : null;
    return message
      ? { at: r.timestamp, line: `Declined ${what}${qty}${at}: "${message}"`, wantsAnswer: true }
      : { at: r.timestamp, line: `Declined ${what}${qty}${at}, no reason given`, wantsAnswer: false };
  }
  if (r.type === "PROPOSAL_APPROVED" && to?.edited) {
    const size =
      to.quantity != null && to.proposedQuantity != null
        ? `, ${to.quantity < to.proposedQuantity ? "cut" : "raised"} from ${to.proposedQuantity} to ${to.quantity} shares`
        : " with edits";
    return { at: r.timestamp, line: `Approved ${what}${size}${at}`, wantsAnswer: true };
  }
  if (r.type.startsWith("PROPOSAL_")) return null;

  // A hand edit: only the change, a removal included (ABT 10-07: a run read
  // the principal's added buy and never its removal, and set the buy again).
  // The rationale on these lines is the app's sentence, not the principal's words.
  if (isCopiedRuleCleanup(r)) return null;
  const ops = changesOf(r).triggerOps?.to ?? [];
  const change = ops.map((o) => o?.text).filter(Boolean).join("; ") || oneLine(r.summary ?? "");
  return change ? { at: r.timestamp, line: `Set by hand: ${change}${at}`, wantsAnswer: true } : null;
}

const RUN_WORDS: Record<string, string> = {
  MORNING_PLAN: "morning run",
  INTRADAY_TACTICAL: "trigger run",
  THESIS_WRITER: "writer",
  PRINCIPAL_CHAT: "chat",
  DISCOVERY: "discovery",
};
const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "09-14 11:43", Eastern. */
export function etStamp(d: Date): string {
  const p = Object.fromEntries(ET.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** The block every agent reads first on a stock. */
export function buildStockContext(args: {
  ticker: string;
  rows: ActivityRow[];
  /**
   * The principal's removals by hand at any age, loaded on their own like the
   * notes (work-inputs.ts), so the activity window does not decide whether a
   * run is told. Read together with `rows`; a row in both counts once.
   */
  removals?: ActivityRow[];
  /** The stock's resolved triggers, by id: what the fire was, and its rule. */
  labelFor: (triggerId: string) => TriggerLabel | null;
  /** Whether a trigger reading as this sentence is on the stock now: a removal it came back from is not shown. */
  onStock?: (sentence: string) => boolean;
  now: Date;
  /** The live price, for "now" beside the principal's price then. */
  currentPrice?: number | null;
}): StockContext {
  const rows = newestFirst(args.rows);
  const answers = recentAnswers(rows);
  const last = answers[0] ?? null;
  const since = last ? rows.slice(0, rows.indexOf(last)) : rows;
  const fires = openFires(rows);
  // The price when a decision was made: its own line's, or the newest before it.
  const priceBefore = (r: ActivityRow) => rows.slice(rows.indexOf(r)).find((x) => typeof x.priceAtTime === "number")?.priceAtTime ?? null;
  const decisions = since
    .map((r) => principalDecision(r, priceBefore(r), args.currentPrice ?? null))
    .filter((d): d is PrincipalDecision => d != null);
  const notes = newestNotes(rows);
  // A note written after the last answer puts the stock on the list once, so a run reads it in full.
  const newNote = notes.find((n) => !last || n.timestamp > last.timestamp);
  const unansweredDecision =
    decisions.find((d) => d.wantsAnswer) ??
    (newNote ? { at: newNote.timestamp, line: `Note: ${oneLine(newNote.rationale ?? "")}`, wantsAnswer: true } : null);
  // What the principal took off the stock stays said after a run answers it;
  // not once a trigger reading the same is back on the stock.
  const removed = removedByHand([...rows, ...(args.removals ?? [])])
    .filter((x) => !args.onStock?.(x.sentence))
    .slice(0, REMOVALS_SHOWN);
  if (!last && decisions.length === 0 && fires.length === 0 && !notes.length && !removed.length) {
    return { text: null, openFires: fires, unansweredDecision, principalNote: null };
  }

  const T = args.ticker.toUpperCase();
  const lines = [`WHAT'S BEEN SAID ON $${T}`];
  if (notes.length) lines.push("The principal's notes:");
  for (const n of notes) {
    const then = thenNow(n.priceAtTime ?? null, args.currentPrice ?? null);
    lines.push(`  ${etStamp(n.timestamp)}${then}: "${oneLine(n.rationale ?? "")}"`);
  }
  // Counted against the cap with the notes, and like them never cut.
  if (removed.length) lines.push(REMOVALS_HEADER);
  for (const x of removed) lines.push(`  ${etStamp(x.at)}: ${x.sentence}`);
  const quoted = (r: ActivityRow, n: number) => (r.rationale?.trim() ? ` — "${sentences(r.rationale.split(/\n\s*\n\s*\[/)[0], n)}"` : "");
  const ranBy = (r: ActivityRow) => (r.runMode && RUN_WORDS[r.runMode]) ?? "a run";
  lines.push(last ? `Last look: ${ranBy(last)}, ${etStamp(last.timestamp)}${quoted(last, LAST_NOTE_CHARS)}` : "Last look: none on record.");
  if (answers.length > 1) lines.push("Before that:");
  for (const r of answers.slice(1)) {
    lines.push(`  ${ranBy(r)}, ${etStamp(r.timestamp)}${typeof r.priceAtTime === "number" ? ` at ${money(r.priceAtTime)}` : ""}${quoted(r, EARLIER_NOTE_CHARS)}`);
  }
  const tail = `Full history: get_theses(tickers: ["${T}"], include_history: true)`;

  if (decisions.length === 0 && fires.length === 0) {
    lines.push("Nothing since.");
  } else {
    const sinceAt = lines.length;
    lines.push("Since then, not yet answered:");
    for (const d of decisions) lines.push(`  The principal, ${etStamp(d.at)}: ${d.line}`);
    const label = (f: OpenFire) => args.labelFor(f.triggerId)?.label ?? oneLine(f.summary ?? "a trigger since removed");
    const folded: OpenFire[] = [];
    let used = [...lines.slice(sinceAt), tail].join("\n").length;
    for (const f of fires) {
      const rule = args.labelFor(f.triggerId)?.rationale;
      const when = f.count === 1 ? etStamp(f.lastAt) : `fired ${f.count}×, ${etStamp(f.firstAt)} to ${etStamp(f.lastAt)}, last`;
      const line = `  ${label(f)} — ${when}${f.lastPrice != null ? ` at ${money(f.lastPrice)}` : ""}.${rule ? ` The rule: "${sentences(rule)}"` : ""}`;
      if (folded.length === 0 && used + line.length + 1 <= CONTEXT_CHAR_CAP) {
        lines.push(line);
        used += line.length + 1;
      } else folded.push(f);
    }
    if (folded.length) lines.push(`  and ${folded.length} more fired since: ${folded.map((f) => `${label(f)}${f.count > 1 ? ` (${f.count}×)` : ""}`).join("; ")}.`);
  }
  lines.push(tail);
  const p0 = notes[0];
  const principalNote = p0 ? `${etStamp(p0.timestamp)}: ${sentences(p0.rationale ?? "", 120)}` : null;
  return { text: lines.join("\n"), openFires: fires, unansweredDecision, principalNote };
}
