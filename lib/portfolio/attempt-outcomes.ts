/**
 * attempt-outcomes.ts — what became of every buy, sell, trim or add that
 * was supposed to happen and did not reach the principal as a proposal.
 *
 * The Activity feed showed trades and proposals. It did not show the other
 * three things that can happen when a buy price is hit or a sell line is
 * broken, and in the 30 days to 2026-09-28 those were most of them: 30 buy
 * prices hit, 7 proposals, 15 stopped by a rule, 8 passed by the analyst.
 * DOCU's buy fired at 09:30 on 09-28 and left no trace anywhere the
 * principal looks.
 *
 * An attempt starts from a recorded event and ends in exactly one outcome.
 * The outcome is decided by rows, in this order, and never by reading words
 * (the analyst's, or a refusal's):
 *
 *   PROPOSED  an order for that stock, on that side, from that run — or
 *             one already waiting for an answer when the run started. The
 *             feed already shows these; nothing is added.
 *   BLOCKED   no order, and the trade tool was refused in that run. The
 *             refusal's own words are the reason.
 *   FAILED    no order, no refusal, and the run did not finish.
 *   PASSED    none of the above: the analyst looked and chose not to. Often
 *             the right call, so it is neutral, not an error. The analyst's
 *             note is shown as the reason; the TYPE does not depend on it.
 *             Worded as the stock's own timeline words it: a buy is
 *             "passed", a sale is "held".
 *
 * Two kinds of attempt:
 *   - a trigger run woken by a trigger whose action is a transaction
 *     (ENTER, ADD, EXIT, TRIM). A REVIEW is not a transaction and is never
 *     an attempt.
 *   - a trade tool refused inside any other run (a morning run, the chat)
 *     that never landed.
 *
 * The homepage reads these beside the stocks' Activity lists
 * (lib/thesis/account-activity.server.ts): a refusal and a run that broke are
 * not Activity lines, so a stock's list cannot carry them.
 *
 * Pure: rows in, feed lines out. No prisma, no clock.
 */

export type AttemptKind = "BLOCKED" | "PASSED" | "FAILED";

/** The four trigger actions that are supposed to end in a transaction. */
const SIDE_OF_ACTION: Record<string, "BUY" | "SELL"> = {
  ENTER: "BUY",
  ADD: "BUY",
  EXIT: "SELL",
  TRIM: "SELL",
};

const SIDE_OF_INTENT: Record<string, "BUY" | "SELL"> = {
  OPEN: "BUY",
  ADD: "BUY",
  CLOSE: "SELL",
  PARTIAL_CLOSE: "SELL",
};

/** The tools that can end in a transaction. */
export const TRADE_TOOLS = ["place_trade", "close_position", "manage_position"];

/**
 * Which transaction a refused trade tool refused, from the tool alone: a buy,
 * a sale, or either for manage_position, which adds or trims (stop moves left
 * it for update_thesis) and whose refusal stores no arguments. Null for any
 * other tool.
 */
const SIDE_OF_TOOL: Readonly<Record<string, "BUY" | "SELL" | "EITHER">> = {
  place_trade: "BUY",
  close_position: "SELL",
  manage_position: "EITHER",
};
export function sideOfRefusal(r: { tool: string }): "BUY" | "SELL" | "EITHER" | null {
  return SIDE_OF_TOOL[r.tool] ?? null;
}

const WORD_OF_ACTION: Record<string, string> = {
  ENTER: "Buy",
  ADD: "Add",
  EXIT: "Sale",
  TRIM: "Trim",
};

/**
 * The words for a pass. The stock's own timeline already has them
 * (`outcomePhrase` in thesis-timeline-utils): a buy that fired and was not
 * bought is "passed"; a sale that fired and was not sold is "held". One
 * vocabulary, so the feed and the stock's page never disagree on the word.
 */
const PASS_LABEL: Record<string, string> = {
  ENTER: "Buy passed",
  ADD: "Add passed",
  EXIT: "Held, not sold",
  TRIM: "Held, not trimmed",
};

const WORD_OF_TOOL: Record<string, string> = {
  place_trade: "Buy",
  close_position: "Sale",
  manage_position: "Position change",
};

export interface AttemptRun {
  id: string;
  mode: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  analystId: string | null;
  /** The stock and the action of the trigger that woke the run, when one did. */
  ticker: string | null;
  action: string | null;
  /** Why it failed, when it did and said so. */
  error: string | null;
}

export interface AttemptOrder {
  symbol: string;
  intent: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttemptRefusal {
  runId: string | null;
  tool: string;
  ticker: string | null;
  summary: string;
  detail: string | null;
  createdAt: Date;
}

/** What the run wrote on the stock — shown as the reason for a pass. */
export interface AttemptNote {
  runId: string;
  ticker: string;
  rationale: string | null;
  timestamp: Date;
}

export interface AttemptLine {
  /** Stable across reads: one line per attempt. */
  id: string;
  kind: AttemptKind;
  ticker: string;
  /** "Buy passed", "Sale blocked", "Add failed". */
  label: string;
  reason: string;
  side: "BUY" | "SELL" | "EITHER";
  runId: string;
  analystId: string | null;
  at: Date;
}

const MINUTE = 60_000;

/** The run's own window, a minute either side: the order is written mid-run. */
function windowOf(run: AttemptRun): [number, number] {
  const start = run.startedAt.getTime();
  const end = (run.completedAt ?? new Date(start + 30 * MINUTE)).getTime();
  return [start - MINUTE, end + MINUTE];
}

function sideMatches(orderSide: "BUY" | "SELL" | undefined, side: "BUY" | "SELL" | "EITHER"): boolean {
  if (!orderSide) return false;
  return side === "EITHER" || orderSide === side;
}

/**
 * Did this attempt reach the principal? Either the run wrote an order, or
 * one on the same side was already waiting for an answer when the run
 * started — a protective sale re-fires every day its line is broken, and a
 * second proposal on top of a pending one is refused by design.
 */
function reachedThePrincipal(
  run: AttemptRun,
  ticker: string,
  side: "BUY" | "SELL" | "EITHER",
  orders: AttemptOrder[],
): boolean {
  const [from, to] = windowOf(run);
  const start = run.startedAt.getTime();
  return orders.some((o) => {
    if (o.symbol !== ticker || !sideMatches(SIDE_OF_INTENT[o.intent], side)) return false;
    const created = o.createdAt.getTime();
    if (created >= from && created <= to) return true;
    if (created > start) return false;
    // Written before the run: was it still unanswered when the run began?
    return o.status === "AWAITING_APPROVAL" || o.updatedAt.getTime() >= start;
  });
}

/** A refusal's reason: its own full sentence when it gave one, else its summary, as written. */
export function refusalReason(r: { summary: string; detail: string | null }): string {
  return r.detail?.trim() || r.summary;
}

export function attemptOutcomes(input: {
  runs: AttemptRun[];
  orders: AttemptOrder[];
  refusals: AttemptRefusal[];
  notes: AttemptNote[];
}): AttemptLine[] {
  const { runs, orders, refusals, notes } = input;
  const out: AttemptLine[] = [];
  const runById = new Map(runs.map((r) => [r.id, r]));
  // Only refusals of a transaction. A refused stop move is not an attempt.
  const tradeRefusals = refusals
    .filter((r) => r.runId && r.ticker)
    .map((r) => ({ ...r, side: sideOfRefusal(r) }))
    .filter((r): r is typeof r & { side: "BUY" | "SELL" | "EITHER" } => r.side != null);

  // ── 1. A trigger that is supposed to end in a transaction woke a run ──
  const triggerRuns = new Set<string>();
  for (const run of runs) {
    if (run.mode !== "INTRADAY_TACTICAL" || !run.ticker || !run.action) continue;
    const side = SIDE_OF_ACTION[run.action];
    if (!side) continue;
    triggerRuns.add(run.id);
    // Still running: no outcome yet.
    if (run.status === "RUNNING") continue;
    if (reachedThePrincipal(run, run.ticker, side, orders)) continue;

    const word = WORD_OF_ACTION[run.action];
    const base = {
      ticker: run.ticker,
      side,
      runId: run.id,
      analystId: run.analystId,
      at: run.startedAt,
    };
    // The LAST refusal is the one that stood; an earlier one may have been
    // a fixable argument the run then got right.
    const refused = tradeRefusals
      .filter((r) => r.runId === run.id && r.ticker === run.ticker && (r.side === "EITHER" || r.side === side))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (refused) {
      out.push({ ...base, id: `attempt-${run.id}`, kind: "BLOCKED", label: `${word} blocked`, reason: refusalReason(refused) });
      continue;
    }
    if (run.status === "FAILED") {
      out.push({
        ...base,
        id: `attempt-${run.id}`,
        kind: "FAILED",
        label: `${word} failed`,
        reason: run.error?.trim() || "The run did not finish, and did not say why.",
      });
      continue;
    }
    const note = notes
      .filter((n) => n.runId === run.id && n.ticker === run.ticker)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    out.push({
      ...base,
      id: `attempt-${run.id}`,
      kind: "PASSED",
      label: PASS_LABEL[run.action],
      reason: note?.rationale?.trim() || "The analyst looked and did not act, and wrote no reason.",
    });
  }

  // ── 2. A trade tool refused inside any other run, and never landed ────
  const seen = new Set<string>();
  const latestFirst = [...tradeRefusals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const r of latestFirst) {
    if (triggerRuns.has(r.runId!)) continue;
    const key = `${r.runId}|${r.ticker}|${r.tool}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const run = runById.get(r.runId!);
    const side = r.side;
    // Without the run's window there is no way to say it never landed.
    if (!run || reachedThePrincipal(run, r.ticker!, side, orders)) continue;
    out.push({
      id: `attempt-${r.runId}-${r.ticker}-${r.tool}`,
      kind: "BLOCKED",
      ticker: r.ticker!,
      label: `${WORD_OF_TOOL[r.tool]} blocked`,
      reason: refusalReason(r),
      side,
      runId: r.runId!,
      analystId: run.analystId,
      at: r.createdAt,
    });
  }

  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}
