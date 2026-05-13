/**
 * narration-gate — detect agent narration that implies a tool call but
 * never fires one.
 *
 * Same bug class place_trade had on 2026-04-29 → 05-01 (PR #210/#226):
 * the agent writes "tightening the stop on $X" or "$INTC closed due to
 * overextension" in the run summary's reasoning text but emits zero
 * `manage_position` / `close_position` calls. The existing morning-research
 * gate only catches the place_trade case (primary_decision=ADD/ROTATE with
 * tradesPlaced=0). This module covers the other action verbs.
 *
 * Watchlist verbs were dropped in the watchlist collapse — there's no
 * dedicated tool to point at (record_thesis for adds, update_thesis(ARCHIVED)
 * for removes), and the existing close/exit/invalidate verb rules catch
 * the agent's "removing X" intent against the thesis lifecycle.
 *
 * Invoked from record_run_summary's persistence path. Pure functions —
 * no Prisma imports here so it's unit-testable without a DB.
 */

export type ExpectedTool =
  | "close_position"
  | "manage_position";

export interface NarrationHit {
  ticker: string;
  expectedTool: ExpectedTool;
  verb: string;
  context: string;
  source: "rationale" | "pick_reasoning";
}

export type NarrationGap = NarrationHit;

interface VerbRule {
  pattern: RegExp;
  expectedTool: ExpectedTool;
  label: string;
}

// Rules. Keep regex flags `gi` — global so .exec walks every match,
// case-insensitive so "Closed"/"closed"/"CLOSED" all hit.
//
// place_trade verbs (buy / open / promote-to-active / initiate /
// new position) are intentionally excluded — that path is gated
// upstream by the morning-research trade-execution gap check.
export const VERB_RULES: VerbRule[] = [
  // close_position
  {
    pattern: /\b(closing|closed|exit|exiting|exited|sell|selling|sold)\b/gi,
    expectedTool: "close_position",
    label: "close/exit",
  },
  // manage_position — stop adjustments
  {
    pattern: /\b(tighten|tightened|tightening)\b/gi,
    expectedTool: "manage_position",
    label: "tighten stop",
  },
  {
    pattern: /\b(raised|raising|moving|moved)\s+(?:the\s+)?stop\b/gi,
    expectedTool: "manage_position",
    label: "move stop",
  },
  {
    pattern: /\btrail(?:ing\s+stop|\s+to\b)/gi,
    expectedTool: "manage_position",
    label: "trailing stop",
  },
  // manage_position — sizing
  {
    pattern: /\b(trim|trimmed|trimming)\b/gi,
    expectedTool: "manage_position",
    label: "trim",
  },
  {
    pattern: /\bscal(?:e|ed|ing)\s+(?:out|in)\b/gi,
    expectedTool: "manage_position",
    label: "scale in/out",
  },
  {
    pattern: /\bpartial\s+close\b/gi,
    expectedTool: "manage_position",
    label: "partial close",
  },
  // "added to" / "adding to" — but NOT "added to watchlist" (those are now
  // record_thesis/update_thesis calls handled by the agent prompt + tool
  // gates, not this gate).
  {
    pattern: /\b(added|adding)\s+to\b(?!\s+(?:my\s+|the\s+|a\s+)?watchlist)/gi,
    expectedTool: "manage_position",
    label: "add to position",
  },
  {
    pattern: /\bdoubled?\s+up\b/gi,
    expectedTool: "manage_position",
    label: "double up",
  },
  // generic position-adjustment verb. Tightened 2026-05-13 (GAPS P0-8):
  // bare \badjusted\b false-positived on "adjusted target / thesis / plan"
  // which are correctly handled by update_thesis (target/stop are thesis
  // operational state, not position state). Require a position-management
  // noun (stop/trail/size/qty/position) within ~30 chars in either
  // direction. 2026-05-13 EV Catalyst TSLA failed on the bare pattern.
  {
    pattern: /\badjusted\b[^.]{0,30}\b(stop|trail(?:ing)?|size|qty|quantity|position)\b/gi,
    expectedTool: "manage_position",
    label: "adjust",
  },
  {
    pattern: /\b(stop|trail(?:ing)?|size|qty|quantity|position)\b[^.]{0,30}\badjusted\b/gi,
    expectedTool: "manage_position",
    label: "adjust",
  },
];

const DOLLAR_TICKER_RE = /\$([A-Z]{1,5})\b/g;
const BARE_TICKER_RE = /\b([A-Z]{2,5})\b/g;

// Common 1-letter tickers that look like sentence starters / placeholders;
// the dollar-prefixed form ($X, $A) almost always means a placeholder, not a
// real ticker, so block them from matching.
const DOLLAR_BLOCKLIST = new Set(["X", "A", "I"]);

function nearestTicker(
  text: string,
  anchor: number,
  knownTickers: Set<string>,
  span = 80,
): string | null {
  const start = Math.max(0, anchor - span);
  const end = Math.min(text.length, anchor + span);
  const window = text.slice(start, end);
  const localAnchor = anchor - start;

  // Single ranking pass — both $TICKER mentions and bare tickers (when
  // they're in the run's known-ticker set) compete on raw distance to
  // the verb. Prefer-$-over-bare was wrong for cases like
  // "MU adjusted ... $INTC closed" where the verb belongs to MU but
  // $INTC sits a few words later.
  let best: { ticker: string; distance: number } | null = null;

  DOLLAR_TICKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DOLLAR_TICKER_RE.exec(window)) != null) {
    const idx = m.index;
    const ticker = m[1].toUpperCase();
    if (DOLLAR_BLOCKLIST.has(ticker)) continue;
    const distance = Math.abs(idx - localAnchor);
    if (!best || distance < best.distance) best = { ticker, distance };
  }

  if (knownTickers.size > 0) {
    BARE_TICKER_RE.lastIndex = 0;
    let bm: RegExpExecArray | null;
    while ((bm = BARE_TICKER_RE.exec(window)) != null) {
      const idx = bm.index;
      const ticker = bm[1].toUpperCase();
      if (!knownTickers.has(ticker)) continue;
      const distance = Math.abs(idx - localAnchor);
      if (!best || distance < best.distance) best = { ticker, distance };
    }
  }

  return best?.ticker ?? null;
}

export function detectNarrationHits(
  text: string,
  source: "rationale" | "pick_reasoning",
  attributedTicker: string | undefined,
  knownTickers: Set<string>,
): NarrationHit[] {
  if (!text) return [];
  const hits: NarrationHit[] = [];
  for (const rule of VERB_RULES) {
    // Fresh regex per scan so the global lastIndex doesn't leak across
    // calls (rules array is module-level).
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) != null) {
      const idx = m.index;
      const ticker =
        attributedTicker?.toUpperCase() ??
        nearestTicker(text, idx, knownTickers);
      if (!ticker) continue;
      const ctxStart = Math.max(0, idx - 30);
      const ctxEnd = Math.min(text.length, idx + m[0].length + 30);
      hits.push({
        ticker,
        expectedTool: rule.expectedTool,
        verb: m[0].trim(),
        context: text.slice(ctxStart, ctxEnd).trim(),
        source,
      });
    }
  }
  return hits;
}

const RUN_EVENT_TYPE_TO_TOOL: Record<string, ExpectedTool> = {
  position_closed: "close_position",
  position_modified: "manage_position",
};

// What counts as "the tool fired" for each narrated intent. close_position
// narration is satisfied if a position_closed event exists for that ticker
// (whether close_position or manage_position with full scale-out fired it).
// manage_position narration is satisfied by either event — a "trim" that
// turns into a full close still counts as managing.
const SATISFYING_TOOLS: Record<ExpectedTool, ExpectedTool[]> = {
  close_position: ["close_position", "manage_position"],
  manage_position: ["manage_position", "close_position"],
};

export interface ToolCallEvent {
  type: string; // RunEvent.type
  symbol: string; // ticker, will be uppercased
}

export function findGaps(
  hits: NarrationHit[],
  events: ToolCallEvent[],
): NarrationGap[] {
  const firedByTicker = new Map<string, Set<ExpectedTool>>();
  for (const e of events) {
    const tool = RUN_EVENT_TYPE_TO_TOOL[e.type];
    if (!tool) continue;
    const sym = e.symbol.toUpperCase();
    if (!firedByTicker.has(sym)) firedByTicker.set(sym, new Set());
    firedByTicker.get(sym)!.add(tool);
  }

  const gaps: NarrationGap[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = `${hit.ticker}:${hit.expectedTool}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fired = firedByTicker.get(hit.ticker) ?? new Set<ExpectedTool>();
    const accepts = SATISFYING_TOOLS[hit.expectedTool];
    const satisfied = accepts.some((t) => fired.has(t));
    if (!satisfied) gaps.push(hit);
  }
  return gaps;
}
