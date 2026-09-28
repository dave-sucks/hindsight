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
 * The outcome is decided by rows, in this order, and never by reading what
 * the analyst wrote:
 *
 *   PROPOSED  an order for that stock, on that side, from that run — or
 *             one already waiting for an answer when the run started. The
 *             feed already shows these; nothing is added.
 *   BLOCKED   no order, and the trade tool was refused in that run. The
 *             refusal's own words are the reason.
 *   FAILED    no order, no refusal, and the run did not finish.
 *   PASSED    none of the above: the analyst looked and chose not to. Often
 *             the right call, so it is neutral, not an error. The analyst's
 *             sentence is shown as the reason; the TYPE does not depend on it.
 *
 * Two kinds of attempt:
 *   - a trigger run woken by a trigger whose action is a transaction
 *     (ENTER, ADD, EXIT, TRIM). A REVIEW is not a transaction and is never
 *     an attempt.
 *   - a trade tool refused inside any other run (a morning run, the chat)
 *     that never landed.
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
 * Which transaction a refusal refused — or null when it refused something
 * that is not a transaction. `manage_position` also moves stops: on
 * 2026-09-14 MU and SMMT were woken by an add trigger, tried to move the
 * stop to breakeven, were refused that, and did not add. That is a pass on
 * the add, not a blocked add.
 */
export function sideOfRefusal(r: { tool: string; summary: string }): "BUY" | "SELL" | "EITHER" | null {
  if (r.tool === "place_trade") return "BUY";
  if (r.tool === "close_position") return "SELL";
  if (r.tool !== "manage_position") return null;
  if (/^Add\b/i.test(r.summary)) return "BUY";
  if (/^(Partial close|Nothing left to trim)/i.test(r.summary)) return "SELL";
  if (/^(Refused (stop change|breakeven move)|No target or stop)/i.test(r.summary)) return null;
  return "EITHER";
}

const WORD_OF_ACTION: Record<string, string> = {
  ENTER: "Buy",
  ADD: "Add",
  EXIT: "Sale",
  TRIM: "Trim",
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

/**
 * The analyst's reason, in its own words: the first two sentences. The
 * first is usually the announcement ("Passed on the $DOCU entry.") and the
 * second the reason, so one sentence is not enough. The row shows what
 * fits; the hover shows all of it.
 */
export function passReason(text: string | null | undefined, max = 360): string {
  const clean = (text ?? "")
    .replace(/\[Belief unchanged:[^\]]*\]?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  // A sentence ends at a full stop followed by a space and a capital — not
  // at "$67." or "09:30 ET.", which is where a naive split cuts prices.
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z"'“$])/);
  const two = sentences.slice(0, 2).join(" ").trim();
  return two.length > max ? `${two.slice(0, max - 1).trimEnd()}…` : two;
}

/** Older refusals stored only a label. Say them in plain words. */
const PLAIN_REFUSAL: Array<[RegExp, string]> = [
  [/below min composite/i, "The stock's score is under this analyst's minimum to buy."],
  [/below min position size/i, "The buy came out smaller than this analyst's smallest trade."],
  [/exceeds live promotion cap/i, "The buy was larger than the live cap on this analyst."],
  [/at max open positions/i, "This analyst has no room: it holds as many positions as it is allowed."],
  [/exceeds largest trade/i, "The buy was larger than this analyst's largest trade."],
];

export function refusalReason(r: { summary: string; detail: string | null }): string {
  const own = (r.detail ?? "")
    .replace(/^Trade blocked:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (own) return own.charAt(0).toUpperCase() + own.slice(1);
  const plain = PLAIN_REFUSAL.find(([re]) => re.test(r.summary));
  if (plain) return plain[1];
  const label = r.summary
    .replace(/^Trade blocked:\s*/i, "")
    .replace(/^\$?[A-Z]{1,5}\s+—\s+/, "")
    .trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
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
      label: `${word} passed`,
      reason: passReason(note?.rationale) || "The analyst looked and did not act, and wrote no reason.",
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
