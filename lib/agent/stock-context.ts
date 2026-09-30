/**
 * stock-context.ts — what an agent is handed about one stock before it
 * decides: what the principal wants now, what the analyst concluded last
 * time, and what has happened since (docs/plans/AGENT_CONTEXT.md §3.2, §3.3).
 *
 * Everything counts from the analyst's LAST ANSWER — the newest line a run
 * wrote on the stock:
 *
 *  - The last answer itself, one line.
 *  - The principal's decisions after it, word for word, with the price then
 *    and now. Once an agent answers a decision it is done; a wish meant to
 *    stand belongs in a note.
 *  - Every trigger fired after it, collapsed, with its rule.
 *
 * Nothing else. Rendered against CEG's rows for 09-30, the first version
 * of this block carried ~650 tokens: the principal's 09-14 "Hard reject… add,
 * not exit" at $250 (anchoring a hold on a loser), two copies of the run's
 * own "hold", a cleanup of copied rules and bookkeeping lines. The one line
 * that run needed was the 15%-off-the-high review nobody had answered.
 *
 * A fire stays open until an agent answers it — a later fire, the
 * principal's edit or the app's bookkeeping does not close it. CEG's "15% off
 * the high" review fired twice and no run was handed it: on 09-16 a later
 * fire took its place, and on 09-28 the principal's cleanup 36 minutes later
 * counted as its answer. get_theses, the trigger run, complete_run and the
 * thesis sheet all read the same rule from here.
 *
 * Pure: needs-action.ts imports it, and the trigger labels come in from the
 * caller (describePredicate lives with the evaluator).
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
  /** The writing run's mode, when the caller joined it. Labels the last answer. */
  runMode?: string | null;
  priceAtTime?: number | null;
}

/** A trigger that fired since the last agent answer. */
export interface OpenFire {
  triggerId: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
  /** The price on the newest fire's line, when it carried one. */
  lastPrice: number | null;
  /** The newest fire line's own summary — the fallback when the trigger is gone. */
  summary: string | null;
}

/** One of the principal's decisions, as an agent reads it. */
export interface PrincipalDecision {
  at: Date;
  line: string;
  /**
   * A decline with a written reason, a resized approval, a level set by
   * hand: unanswered, it puts the stock on the morning run's full list. A
   * bare decline is shown but doesn't.
   */
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
  /** The newest decision since the last answer that wants an answer. */
  unansweredDecision: PrincipalDecision | null;
}

/** ~400 tokens. Past it, the alerts that don't fit fold into a count. Decisions are never cut. */
export const CONTEXT_CHAR_CAP = 1_600;
/** Whole sentences up to this; a single longer sentence is cut at a word. */
const ANSWER_CHARS = 220;
const RULE_CHARS = 220;

type Changes = {
  source?: { to?: unknown };
  triggerOps?: { to?: Array<{ op?: string; text?: string }> };
  proposal?: {
    to?: {
      intent?: string;
      quantity?: number;
      proposedQuantity?: number;
      edited?: boolean;
      userMessage?: string;
    };
  };
};

const changesOf = (r: ActivityRow): Changes =>
  r.fieldChanges && typeof r.fieldChanges === "object" ? (r.fieldChanges as Changes) : {};

const newestFirst = (rows: ActivityRow[]): ActivityRow[] =>
  [...rows].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

/** A line the principal wrote: a proposal decision, or an edit made by hand. */
export function isPrincipalRow(r: ActivityRow): boolean {
  if (r.type.startsWith("PROPOSAL_")) return true;
  if (r.runId) return false;
  if (typeof r.rationale === "string" && r.rationale.startsWith("[USER]")) return true;
  return changesOf(r).source?.to === "USER";
}

/**
 * A line an agent wrote about the stock: a review, an update, a status move,
 * a close. Not a fire, not a proposal decision, not the principal's edit, not
 * the app's bookkeeping (a buy price set to what was paid, a status change
 * written by a fill — those carry no run).
 */
export function isAgentAnswer(r: ActivityRow): boolean {
  if (!r.runId) return false;
  if (r.type === "TRIGGER_FIRED") return false;
  return !isPrincipalRow(r);
}

/** Every trigger that fired after the newest agent answer, newest first. */
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

const INTENT_WORDS: Record<string, string> = {
  CLOSE: "the sale",
  PARTIAL_CLOSE: "the partial sale",
  OPEN: "the buy",
  ADD: "the add",
};

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const money = (n: number): string => `$${n.toFixed(2)}`;

/** Cut at a word boundary, with an ellipsis. */
function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > n * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** Whole sentences up to `n` characters; one sentence longer than that is cut at a word. */
function sentencesUpTo(text: string, n: number): string {
  const parts = oneLine(text).split(/(?<=[.!?])\s+/);
  let out = "";
  for (const p of parts) {
    const next = out ? `${out} ${p}` : p;
    if (next.length > n) break;
    out = next;
  }
  return out || clip(parts[0] ?? "", n);
}

/** "at $273.98, now $250.00 (−8.8%)" — as much of it as the prices allow. */
function priceThenNow(then: number | null, now: number | null | undefined): string {
  if (then == null) return "";
  if (now == null || now <= 0) return ` at ${money(then)}`;
  const pct = ((now - then) / then) * 100;
  const sign = pct >= 0 ? "+" : "−";
  return ` at ${money(then)}, now ${money(now)} (${sign}${Math.abs(pct).toFixed(1)}%)`;
}

/**
 * The principal's decision on one line, or null when there is nothing to
 * decide: a plain approval (the position shows it), a hand edit that only
 * removed triggers, an expiry, anything that isn't the principal's.
 * `priceThen` is the price on the stock when it was made.
 */
export function principalDecision(
  r: ActivityRow,
  priceThen: number | null = null,
  priceNow: number | null = null,
): PrincipalDecision | null {
  if (!isPrincipalRow(r)) return null;
  const at = priceThenNow(priceThen, priceNow);
  const to = changesOf(r).proposal?.to;
  const what = (to?.intent && INTENT_WORDS[to.intent]) ?? "the proposal";
  const qty = to?.quantity != null ? ` (${to.quantity} shares)` : "";

  if (r.type === "PROPOSAL_REJECTED") {
    const raw = to?.userMessage ?? r.rationale ?? "";
    // A no-message decline stores a "[REJECTED:USER] …" sentinel.
    const message = raw && !raw.startsWith("[REJECTED:USER]") ? oneLine(raw) : null;
    return message
      ? { at: r.timestamp, line: `Declined ${what}${qty}${at}: "${message}"`, wantsAnswer: true }
      : { at: r.timestamp, line: `Declined ${what}${qty}${at}, no reason given`, wantsAnswer: false };
  }

  if (r.type === "PROPOSAL_APPROVED") {
    if (!to?.edited) return null;
    const resized =
      to.quantity != null && to.proposedQuantity != null
        ? `, ${to.quantity < to.proposedQuantity ? "cut" : "raised"} from ${to.proposedQuantity} to ${to.quantity} shares`
        : " with edits";
    return { at: r.timestamp, line: `Approved ${what}${resized}${at}`, wantsAnswer: true };
  }

  if (r.type.startsWith("PROPOSAL_")) return null; // expired: not a decision

  // A hand edit. Only the change is shown — the rationale on these lines is
  // the app's own sentence, not the principal's words. One that only removed
  // triggers asks nothing (the 09-28 cleanup of copied rules).
  const ops = changesOf(r).triggerOps?.to ?? [];
  const kept = ops.filter((o) => o?.op !== "remove");
  if (ops.length > 0 && kept.length === 0) return null;
  const change = kept.map((o) => o.text).filter((t): t is string => !!t).join("; ") || oneLine(r.summary ?? "");
  if (!change) return null;
  return { at: r.timestamp, line: `Set by hand: ${change}${at}`, wantsAnswer: true };
}

const MODE_WORDS: Record<string, string> = {
  MORNING_PLAN: "morning run",
  INTRADAY_TACTICAL: "trigger run",
  THESIS_WRITER: "writer",
  PRINCIPAL_CHAT: "chat",
  DISCOVERY: "discovery",
};

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "09-14 11:43", Eastern. */
export function etStamp(d: Date): string {
  const p = Object.fromEntries(ET.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** The opening sentence or two of an answer, without the belief footnote. */
function answerLine(rationale: string): string {
  return sentencesUpTo(rationale.split(/\n\s*\n\s*\[/)[0], ANSWER_CHARS);
}

/**
 * The block every agent reads first on a stock. Three things, all counted
 * from the analyst's last answer: that answer, the principal's decisions
 * since, and the triggers fired since. Everything else is one call away.
 */
export function buildStockContext(args: {
  ticker: string;
  rows: ActivityRow[];
  /** The stock's resolved triggers, by id: what the fire was, and its rule. */
  labelFor: (triggerId: string) => TriggerLabel | null;
  now: Date;
  /** The live price, for "now" beside the principal's price then. */
  currentPrice?: number | null;
}): StockContext {
  const rows = newestFirst(args.rows);
  const lastAnswer = rows.find(isAgentAnswer) ?? null;
  const since = lastAnswer ? rows.slice(0, rows.indexOf(lastAnswer)) : rows;
  const fires = openFires(rows);

  // The price on the stock when a decision was made: its own line's, or the
  // newest line before it that recorded one.
  const priceBefore = (r: ActivityRow): number | null => {
    if (typeof r.priceAtTime === "number") return r.priceAtTime;
    const older = rows.slice(rows.indexOf(r) + 1).find((x) => typeof x.priceAtTime === "number");
    return older?.priceAtTime ?? null;
  };
  const decisions = since
    .map((r) => principalDecision(r, priceBefore(r), args.currentPrice ?? null))
    .filter((d): d is PrincipalDecision => d != null);
  const unansweredDecision = decisions.find((d) => d.wantsAnswer) ?? null;

  if (!lastAnswer && decisions.length === 0 && fires.length === 0) {
    return { text: null, openFires: fires, unansweredDecision };
  }

  const T = args.ticker.toUpperCase();
  const head: string[] = [`WHAT'S BEEN SAID ON $${T}`];
  if (lastAnswer) {
    const who = (lastAnswer.runMode && MODE_WORDS[lastAnswer.runMode]) ?? "a run";
    const said = lastAnswer.rationale?.trim() ? ` — "${answerLine(lastAnswer.rationale)}"` : "";
    head.push(`Last look: ${who}, ${etStamp(lastAnswer.timestamp)}${said}`);
  } else {
    head.push("Last look: none on record.");
  }

  const tail = `Full history: get_theses(tickers: ["${T}"], include_history: true)`;
  if (decisions.length === 0 && fires.length === 0) {
    return { text: [...head, "Nothing since.", tail].join("\n"), openFires: fires, unansweredDecision };
  }

  const body: string[] = ["Since then, not yet answered:"];
  // The principal's words first, uncut while unanswered.
  for (const d of decisions) body.push(`  The principal, ${etStamp(d.at)}: ${d.line}`);

  const fireLine = (f: OpenFire): string => {
    const l = args.labelFor(f.triggerId);
    const label = l?.label ?? oneLine(f.summary ?? "a trigger since removed");
    const when =
      f.count === 1
        ? etStamp(f.lastAt)
        : `fired ${f.count}×, ${etStamp(f.firstAt)} to ${etStamp(f.lastAt)}, last`;
    const at = f.lastPrice != null ? ` at ${money(f.lastPrice)}` : "";
    const rule = l?.rationale ? ` The rule: "${sentencesUpTo(l.rationale, RULE_CHARS)}"` : "";
    return `  ${label} — ${when}${at}.${rule}`;
  };
  const shortLabel = (f: OpenFire): string =>
    args.labelFor(f.triggerId)?.label ?? oneLine(f.summary ?? "a trigger since removed");

  // Past the cap, the alerts that don't fit fold into a count.
  const lines = [...head, ...body];
  let used = [...lines, tail].join("\n").length;
  const folded: OpenFire[] = [];
  for (const f of fires) {
    const line = fireLine(f);
    if (folded.length === 0 && used + line.length + 1 <= CONTEXT_CHAR_CAP) {
      lines.push(line);
      used += line.length + 1;
    } else {
      folded.push(f);
    }
  }
  if (folded.length) {
    lines.push(`  and ${folded.length} more fired since: ${folded.map((f) => `${shortLabel(f)}${f.count > 1 ? ` (${f.count}×)` : ""}`).join("; ")}.`);
  }
  lines.push(tail);
  return { text: lines.join("\n"), openFires: fires, unansweredDecision };
}
