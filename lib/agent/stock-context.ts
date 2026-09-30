/**
 * stock-context.ts — what has been said about one stock, the same for every
 * agent that decides on it (docs/plans/AGENT_CONTEXT.md §3.2, §3.3).
 *
 * Two things were lost before this existed, and CEG lost both in September:
 *
 *  - The principal's decision reached an agent only while it was the newest
 *    Activity line. CEG's 09-14 decline ("Hard reject. If anything, today is
 *    a setup for the Secular Compounder to add, not exit.") was the newest
 *    line for four hours; no morning run from 09-16 to 09-30 saw it.
 *  - A fired trigger counted as answered once ANY line landed after it —
 *    a later fire, the principal's edit, the app's bookkeeping. CEG's "15% off
 *    the high" review fired twice and no run was ever handed it: on 09-16 a
 *    later "below the 200-day" fire took its place, and on 09-28 the
 *    principal's cleanup of copied rules, 36 minutes later, closed it.
 *
 * So: a fire stays open until an AGENT answers it (a line a run wrote), and
 * the principal's decisions of the last 30 days travel with the stock,
 * word for word. One pure module, so get_theses, the trigger run,
 * complete_run and the thesis sheet all read the same rule.
 *
 * Pure and dependency-free on purpose: needs-action.ts imports it, and the
 * trigger labels come in from the caller (describePredicate lives with the
 * evaluator, which reaches node:crypto).
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
  /** The writing run's mode, when the caller joined it. Labels an answer. */
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

/** One of the principal's decisions, rendered for an agent. */
export interface PrincipalDecision {
  at: Date;
  line: string;
  /**
   * A decision that asks for an answer: a decline with a written reason, a
   * resized approval, a direct edit. Unanswered, it puts the stock on the
   * morning run's full list once. A plain approval or a bare decline doesn't.
   */
  wantsAnswer: boolean;
}

export interface TriggerLabel {
  label: string;
  rationale?: string | null;
}

export interface StockContext {
  /** The block, ready to print; null when there is nothing to say. */
  text: string | null;
  openFires: OpenFire[];
  /** The newest decision that wants an answer and has none yet. */
  unansweredDecision: PrincipalDecision | null;
}

const DAY_MS = 86_400_000;
/** How far back the principal's decisions travel with the stock. */
export const DECISION_WINDOW_DAYS = 30;
const MAX_DECISIONS = 6;
const DECISION_CHARS = 1_000;
const ANSWER_CHARS = 300;
const MAX_ANSWERS = 2;
const MAX_OTHER_LINES = 5;
/** ~1,000 tokens. Over it, other lines go first, then old decisions, then the second answer. */
export const CONTEXT_CHAR_CAP = 4_000;

type Changes = {
  source?: { to?: unknown };
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
  if (r.type === "PROPOSAL_REJECTED" || r.type === "PROPOSAL_APPROVED") return true;
  if (r.runId) return false;
  if (typeof r.rationale === "string" && r.rationale.startsWith("[USER]")) return true;
  return changesOf(r).source?.to === "USER";
}

/**
 * A line an agent wrote about the stock: a review, an update, a status move,
 * a close. Not a fire, not a proposal decision, not the principal's edit, not
 * the app's own bookkeeping (a buy price set to what was paid, a status
 * change written by a fill — those carry no run).
 */
export function isAgentAnswer(r: ActivityRow): boolean {
  if (!r.runId) return false;
  if (r.type === "TRIGGER_FIRED" || r.type.startsWith("PROPOSAL_")) return false;
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
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The principal's decision on one line, or null when the line isn't one. */
export function principalDecision(r: ActivityRow): PrincipalDecision | null {
  if (!isPrincipalRow(r)) return null;
  const to = changesOf(r).proposal?.to;
  const what = (to?.intent && INTENT_WORDS[to.intent]) ?? "the proposal";

  if (r.type === "PROPOSAL_REJECTED") {
    const raw = to?.userMessage ?? r.rationale ?? "";
    // A no-message decline stores a "[REJECTED:USER] …" sentinel.
    const message = raw && !raw.startsWith("[REJECTED:USER]") ? oneLine(raw) : null;
    const qty = to?.quantity != null ? ` (${to.quantity} shares)` : "";
    return {
      at: r.timestamp,
      line: message
        ? `Declined ${what}${qty}: "${clip(message, DECISION_CHARS)}"`
        : `Declined ${what}${qty}, with no reason given`,
      wantsAnswer: message != null,
    };
  }

  if (r.type === "PROPOSAL_APPROVED") {
    if (to?.edited && to.quantity != null && to.proposedQuantity != null) {
      const way = to.quantity < to.proposedQuantity ? "cut" : "raised";
      return {
        at: r.timestamp,
        line: `Approved ${what}, ${way} from ${to.proposedQuantity} to ${to.quantity} shares`,
        wantsAnswer: true,
      };
    }
    if (to?.edited) return { at: r.timestamp, line: `Approved ${what} with edits`, wantsAnswer: true };
    const qty = to?.quantity != null ? ` (${to.quantity} shares)` : "";
    return { at: r.timestamp, line: `Approved ${what}${qty}`, wantsAnswer: false };
  }

  // A direct edit made by hand.
  const said = typeof r.rationale === "string" ? oneLine(r.rationale.replace(/^\[USER\]\s*/, "")) : "";
  const summary = oneLine(r.summary ?? "Edited the stock");
  return {
    at: r.timestamp,
    line: said ? `${summary}: "${clip(said, DECISION_CHARS)}"` : summary,
    wantsAnswer: true,
  };
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

const priceText = (n: number): string => `$${n.toFixed(2)}`;

/**
 * The block every agent reads first on a stock: the principal's decisions,
 * the last two answers, what has fired since, the other recent lines, and
 * where the rest is. Plain dated lines, never raw rows — a raw history line
 * costs ~1,100 characters of ids and JSON.
 */
export function buildStockContext(args: {
  ticker: string;
  rows: ActivityRow[];
  /** The stock's resolved triggers, by id: what the fire was, and its rule. */
  labelFor: (triggerId: string) => TriggerLabel | null;
  now: Date;
}): StockContext {
  const rows = newestFirst(args.rows);
  const since = args.now.getTime() - DECISION_WINDOW_DAYS * DAY_MS;
  const lastAnswer = rows.find(isAgentAnswer) ?? null;
  const fires = openFires(rows);

  const decisions: PrincipalDecision[] = [];
  for (const r of rows) {
    if (r.timestamp.getTime() < since) break;
    const d = principalDecision(r);
    if (d) decisions.push(d);
  }
  const unansweredDecision =
    decisions.find(
      (d) => d.wantsAnswer && (!lastAnswer || d.at.getTime() > lastAnswer.timestamp.getTime()),
    ) ?? null;

  const answers = rows
    .filter((r) => isAgentAnswer(r) && typeof r.rationale === "string" && r.rationale.trim())
    .slice(0, MAX_ANSWERS);
  const answered = new Set(answers);

  const others = rows.filter(
    (r) =>
      r.timestamp.getTime() >= since &&
      r.type !== "TRIGGER_FIRED" &&
      !isPrincipalRow(r) &&
      !answered.has(r) &&
      !isAgentAnswer(r) &&
      (r.summary ?? "").trim() !== "",
  );

  if (decisions.length === 0 && answers.length === 0 && fires.length === 0 && others.length === 0) {
    return { text: null, openFires: fires, unansweredDecision };
  }

  const T = args.ticker.toUpperCase();
  const decisionLines = decisions.map((d) => `  ${etStamp(d.at)}  ${d.line}`);
  const answerLines = answers.map(
    (r) =>
      `  ${etStamp(r.timestamp)}  ${(r.runMode && MODE_WORDS[r.runMode]) ?? "a run"} — "${clip(oneLine(r.rationale ?? ""), ANSWER_CHARS)}"`,
  );
  const fireLines = fires.map((f) => {
    const l = args.labelFor(f.triggerId);
    const label = l?.label ?? oneLine(f.summary ?? "a trigger that has since been removed");
    const when =
      f.count === 1
        ? `once, ${etStamp(f.lastAt)}`
        : `${f.count}×, first ${etStamp(f.firstAt)}, last ${etStamp(f.lastAt)}`;
    const at = f.lastPrice != null ? ` at ${priceText(f.lastPrice)}` : "";
    const rule = l?.rationale ? ` The rule: "${oneLine(l.rationale)}"` : "";
    return `  ${label} — ${when}${at}.${rule}`;
  });
  const otherLines = others.slice(0, MAX_OTHER_LINES).map((r) => `${etStamp(r.timestamp)} ${oneLine(r.summary ?? "")}`);

  const render = (opts: { decisionsShown: number; answersShown: number; withOthers: boolean }): string => {
    const out: string[] = [`WHAT'S BEEN SAID ON $${T} — read this before the numbers`];
    if (decisions.length) {
      out.push(`The principal — decisions in the last ${DECISION_WINDOW_DAYS} days, word for word:`);
      out.push(...decisionLines.slice(0, opts.decisionsShown));
      const hidden = decisions.length - opts.decisionsShown;
      if (hidden > 0) out.push(`  and ${hidden} earlier`);
    }
    if (answers.length && opts.answersShown > 0) {
      out.push(answers.length === 1 || opts.answersShown === 1 ? "Last answer:" : "Last two answers:");
      out.push(...answerLines.slice(0, opts.answersShown));
    }
    if (fires.length) {
      out.push(
        lastAnswer
          ? `Fired since the last answer (${etStamp(lastAnswer.timestamp)}), not yet answered:`
          : "Fired, not yet answered by any run:",
      );
      out.push(...fireLines);
    }
    if (opts.withOthers && otherLines.length) out.push(`Other lines: ${otherLines.join(" · ")}`);
    out.push(`Full history: get_theses(tickers: ["${T}"], include_history: true)`);
    return out.join("\n");
  };

  // Over the cap, drop in order: other lines, the oldest decisions (counted,
  // not shown), then the second answer. Fires are never dropped.
  let decisionsShown = Math.min(decisions.length, MAX_DECISIONS);
  let answersShown = answers.length;
  let withOthers = true;
  let text = render({ decisionsShown, answersShown, withOthers });
  if (text.length > CONTEXT_CHAR_CAP) {
    withOthers = false;
    text = render({ decisionsShown, answersShown, withOthers });
  }
  while (text.length > CONTEXT_CHAR_CAP && decisionsShown > 1) {
    decisionsShown -= 1;
    text = render({ decisionsShown, answersShown, withOthers });
  }
  if (text.length > CONTEXT_CHAR_CAP && answersShown > 1) {
    answersShown = 1;
    text = render({ decisionsShown, answersShown, withOthers });
  }

  return { text, openFires: fires, unansweredDecision };
}
