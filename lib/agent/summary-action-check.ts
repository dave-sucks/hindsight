/**
 * summary-action-check — a stock the run says it EXITED must have a sale
 * behind it (DAV-309).
 *
 * This replaces the narration gate, which read the run summary's PROSE for
 * words like "exit", "sell" and "tightened" and refused the run when it
 * could not find a matching trade. The idea was right — say what you did,
 * do what you said — but reading English for it does not work, and the
 * cost was not theoretical:
 *
 *   • FIVE, 2026-09-23. The run tightened FIVE's stop from $226.80 to
 *     $229.90 through `update_thesis`, which is how stops move since
 *     triggers became one-at-a-time edits. Its summary said "tightened stop
 *     under 50-day support", which was true. Only `manage_position` /
 *     `close_position` events counted, so the run was refused twice. The
 *     analyst reworded to "thesis risk line revised, no trade order" and
 *     finished. That $229.90 stop is the one that fired at 09:35.
 *   • MU, 2026-09-16. "held, not sold" — a negation — read as a sale.
 *   • MU, 2026-09-04. "the 8% trailing-from-high exit fired" — describing a
 *     trigger, not an action.
 *   • SMMT, 2026-09-11. "the recent sell-side tone improved" — the analyst
 *     community. Patched with a lookahead; the next phrasing was not.
 *
 * `close_position` was called in 8 of the 11 runs this blocked. The damage
 * was the rewording: to finish, analysts made true summaries vaguer or
 * wrong. MU on 09-02 went from EXIT "Below trail; protect gain" to HOLD "no
 * finalized position change". The summaries Dave reads got less true.
 *
 * ── What it does instead ──────────────────────────────────────────────────
 *
 * Every ranked pick already carries a one-word action the agent chose —
 * HOLD, EXIT, REDUCE, ADD, WATCH. That word is structured, unambiguous, and
 * the thing the agent is actually asserting. Check it against the run's
 * events, and only for a stock we hold:
 *
 *   EXIT   → a close, or a sale proposed this run
 *   REDUCE → a trim or a close, or a proposal for one
 *   ADD    → an add, or a proposal for one
 *
 * Everything else owes nothing. **A stop move owes nothing** — it is an edit
 * on the thesis, it shows in Activity, and demanding `manage_position` for
 * it is what broke FIVE.
 *
 * This refuses strictly less than the prose check did: the only case left is
 * a held stock the run marked EXIT with nothing sold and nothing proposed —
 * which is the real miss the gate was built for in May (EV Catalyst/ON
 * 2026-05-20; Catalyst Event Raider/MRVL+OKTA and Secular Theme/SMTC
 * 2026-05-22).
 *
 * ── Where "it happened" is read from ─────────────────────────────────────
 *
 * The ORDER, not the run feed. `position_closed` RunEvents have not been
 * written once since 2026-08-01 — 105 close orders in that window, 64 of
 * them by an agent, and zero credited events — so the old gate was matching
 * narration against a stream that is empty. SRRK on 2026-09-14 is the
 * example: `close_position` fired at 12:00:31 and the order is FILLED in the
 * table, no event was written, and the run was refused five times until the
 * analyst changed SRRK from EXIT to HOLD.
 *
 * So an Order for that stock, opened by this analyst since the run began,
 * is what counts — AWAITING_APPROVAL (a sale proposed) as much as FILLED.
 * Run events are still read where they exist; they cost nothing extra and
 * cover the proposal path that does write them.
 *
 * Pure — no Prisma here, so every case is testable without a database.
 */

export type ExpectedTool = "close_position" | "manage_position";

/** The action verbs `record_run_summary` accepts on a ranked pick. */
export type PickAction =
  | "INITIATE"
  | "ADD"
  | "HOLD"
  | "REDUCE"
  | "EXIT"
  | "WATCH"
  | "REMOVE_WATCH"
  | "PASS"
  | "FAILED";

export interface UnbackedAction {
  ticker: string;
  /** The action the run declared on this stock. */
  action: PickAction;
  /** The tool that action implies. */
  expectedTool: ExpectedTool;
}

/**
 * What each declared action owes, for a stock we hold. An action absent from
 * this table owes nothing: HOLD and WATCH assert that nothing happened,
 * INITIATE is gated upstream by the trade-execution check in
 * morning-research, and FAILED is the agent reporting a refusal honestly.
 */
const ACTION_REQUIRES: Partial<Record<PickAction, ExpectedTool>> = {
  EXIT: "close_position",
  REDUCE: "manage_position",
  ADD: "manage_position",
};

const RUN_EVENT_TYPE_TO_TOOL: Record<string, ExpectedTool> = {
  position_closed: "close_position",
  position_modified: "manage_position",
  // A LIVE sell is a proposal Dave approves — the tool fired, nothing filled
  // yet. Before these counted, the check was blind to every LIVE sell and
  // made agents delete true "proposed the exit" lines (DAV-259).
  position_close_proposed: "close_position",
  position_modify_proposed: "manage_position",
};

/** RunEvent types that count as "the tool fired" — complete_run reads exactly these. */
export const CREDITED_RUN_EVENT_TYPES = Object.keys(RUN_EVENT_TYPE_TO_TOOL);

/**
 * What satisfies each owed tool. A trim that became a full close still
 * counts as managing the position, and a close satisfies a REDUCE — selling
 * all of it is selling some of it.
 */
const SATISFYING_TOOLS: Record<ExpectedTool, ExpectedTool[]> = {
  close_position: ["close_position", "manage_position"],
  manage_position: ["manage_position", "close_position"],
};

export interface ToolCallEvent {
  /** RunEvent.type */
  type: string;
  /** Ticker; compared case-insensitively. */
  symbol: string;
}

/** An Order this analyst opened during the run — the durable record of a trade. */
export interface RunOrder {
  symbol: string;
  /** Order.intent — "CLOSE" | "PARTIAL_CLOSE" | "ADD" | … */
  intent: string | null;
}

const ORDER_INTENT_TO_TOOL: Record<string, ExpectedTool> = {
  CLOSE: "close_position",
  PARTIAL_CLOSE: "manage_position",
  ADD: "manage_position",
};

export interface RankedPick {
  ticker?: unknown;
  action?: unknown;
}

/**
 * Ranked picks on stocks we hold whose declared action has no tool call or
 * proposal behind it. One entry per (ticker, action) — an agent that lists a
 * stock twice is not two failures.
 */
export function findUnbackedActions(input: {
  picks: unknown;
  /** Tickers this analyst currently holds. Anything else owes nothing. */
  heldTickers: Iterable<string>;
  /** Orders this analyst opened since the run began — the durable record. */
  orders?: RunOrder[];
  /** Run events, where they were written. */
  events?: ToolCallEvent[];
}): UnbackedAction[] {
  const picks = Array.isArray(input.picks) ? (input.picks as RankedPick[]) : [];
  if (picks.length === 0) return [];

  const held = new Set<string>();
  for (const t of input.heldTickers) held.add(t.toUpperCase());

  const firedByTicker = new Map<string, Set<ExpectedTool>>();
  const credit = (symbol: string, tool: ExpectedTool | undefined) => {
    if (!tool || !symbol) return;
    const sym = symbol.toUpperCase();
    if (!firedByTicker.has(sym)) firedByTicker.set(sym, new Set());
    firedByTicker.get(sym)!.add(tool);
  };
  for (const o of input.orders ?? []) {
    credit(o.symbol, o.intent ? ORDER_INTENT_TO_TOOL[o.intent.toUpperCase()] : undefined);
  }
  for (const e of input.events ?? []) {
    credit(e.symbol, RUN_EVENT_TYPE_TO_TOOL[e.type]);
  }

  const out: UnbackedAction[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    if (typeof p.ticker !== "string" || !p.ticker) continue;
    if (typeof p.action !== "string") continue;
    const ticker = p.ticker.toUpperCase();
    const action = p.action.toUpperCase() as PickAction;
    const expectedTool = ACTION_REQUIRES[action];
    if (!expectedTool) continue;
    // Only a stock we hold can be exited, trimmed or added to.
    if (!held.has(ticker)) continue;

    const key = `${ticker}:${action}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fired = firedByTicker.get(ticker) ?? new Set<ExpectedTool>();
    if (SATISFYING_TOOLS[expectedTool].some((t) => fired.has(t))) continue;
    out.push({ ticker, action, expectedTool });
  }
  return out;
}

/** The refusal, in the words the agent has to act on. */
export function unbackedActionMessage(gaps: UnbackedAction[]): string {
  const lines = gaps.map(
    (g) =>
      `  • $${g.ticker} is marked ${g.action}, and no ${g.expectedTool} call or proposal for it exists in this run.`,
  );
  return (
    `Your run summary declares an action on ${gaps.length === 1 ? "a stock" : "stocks"} you hold that nothing in this run carried out:\n` +
    `${lines.join("\n")}\n` +
    `Either make the call, or change the action to what actually happened (HOLD if you kept it). ` +
    `Do not reword the reasoning to get past this — the action word is what is checked, not the prose.`
  );
}
