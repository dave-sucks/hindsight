/**
 * run-summary.ts — truthful summaries for the /runs feed cards.
 *
 * The card used to read `Thesis` (analyst opinion: direction + confidence)
 * and render "Long AMZN (83%), Long NVDA (77%)…" which looked like the run
 * placed four new longs when it in fact placed zero trades. The truth of
 * what the run actually DID lives in three tables, joined by `runId`:
 *
 *   - TradeDecision.decision — per-ticker action the agent committed to.
 *     Written by place_trade (INITIATE), close_position (EXIT),
 *     manage_position (ADD / PARTIAL_EXIT), manage_watchlist (WATCH /
 *     REMOVE_WATCH), record_thesis (PASS), record_run_summary (HOLD).
 *     This is the single best source for "what happened per ticker."
 *
 *   - PositionManagementAction.actionType — granular management events
 *     including stops/targets that don't produce a TradeDecision
 *     (MOVE_STOP_TO_BREAKEVEN / SET_TRAILING_STOP / UPDATE_TARGETS).
 *
 *   - Position.realizedPnl / outcome — closed positions carry the $
 *     result; we sum the ones whose EXIT TradeDecision belongs to this
 *     run to get realized P&L for the run.
 *
 * We prefer TradeDecision+PositionManagementAction over the `run_summary`
 * RunEvent payload because the DB is the source of truth for execution —
 * the model's narrated ranked_picks can disagree with what Alpaca filled.
 *
 * Fallback: runs with zero TradeDecisions (legacy runs predating the new
 * decision pipeline) get a minimal summary built from theses, with the
 * `isLegacy` flag set so the UI can mark them.
 */

// ── Input shape (loose — accepts any superset of these fields) ──────────────

export interface RunSummaryInputTheses {
  ticker: string;
  direction: string;
  confidenceScore: number;
}

export interface RunSummaryInputTradeDecision {
  symbol: string;
  decision: string;
  position: {
    realizedPnl: number | null;
    outcome: string | null;
    status: string;
  } | null;
}

export interface RunSummaryInputManagementAction {
  actionType: string;
  position: { symbol: string } | null;
  prevStopLoss: number | null;
  newStopLoss: number | null;
  prevTargetPrice: number | null;
  newTargetPrice: number | null;
  prevTrailPct: number | null;
  newTrailPct: number | null;
}

export interface RunSummaryInput {
  status: string;
  theses: RunSummaryInputTheses[];
  decisions: RunSummaryInputTradeDecision[];
  managementActions: RunSummaryInputManagementAction[];
}

// ── Output shape ────────────────────────────────────────────────────────────

/** Action overlay keys — match ToolProgressTickerItem's TickerActionIcon. */
export type RunActionIcon =
  | "buy"
  | "sell"
  | "watch"
  | "unwatch"
  | "closed-win"
  | "closed-loss"
  | "failed";

export interface TickerResult {
  ticker: string;
  pnl?: number | null;
  what?: string; // for managed: short description of the change
}

export interface RunSummary {
  /** Per-bucket ticker lists, in render priority order. */
  actions: {
    bought: string[];                 // INITIATE
    added: string[];                  // ADD
    sold: TickerResult[];             // EXIT (with $ pnl if closed)
    trimmed: TickerResult[];          // PARTIAL_EXIT
    managed: TickerResult[];          // stop/target moves with no capital change
    held: string[];                   // HOLD
    watched: string[];                // WATCH
    unwatched: string[];              // REMOVE_WATCH
    passed: string[];                 // PASS — kept for counts, never shown
  };
  counts: {
    researched: number;
    new: number;       // bought + added
    closed: number;    // sold.length
    held: number;
    passed: number;
    watchlist: number; // watched + unwatched
    managed: number;   // managed.length
  };
  /** Sum of realized P&L from positions closed during this run. */
  realizedPnl: number | null;
  /** The run errored or produced nothing. */
  isFailed: boolean;
  /** Fell back to thesis-derived summary because no TradeDecisions exist. */
  isLegacy: boolean;
  /** Per-ticker action overlay for the logo stack. */
  tickerOverlays: Map<string, RunActionIcon>;
}

// ── Builder ─────────────────────────────────────────────────────────────────

export function buildRunSummary(run: RunSummaryInput): RunSummary {
  const researched = run.theses.length;
  const isFailed =
    run.status === "FAILED" || (researched === 0 && run.decisions.length === 0);

  const actions: RunSummary["actions"] = {
    bought: [],
    added: [],
    sold: [],
    trimmed: [],
    managed: [],
    held: [],
    watched: [],
    unwatched: [],
    passed: [],
  };

  const overlays = new Map<string, RunActionIcon>();
  let realized = 0;
  let hasAnyClose = false;

  // ── Pass 1: TradeDecisions (authoritative per-ticker action) ──────────
  for (const d of run.decisions) {
    const t = d.symbol.toUpperCase();
    switch (d.decision) {
      case "INITIATE":
        actions.bought.push(t);
        overlays.set(t, "buy");
        break;
      case "ADD":
        actions.added.push(t);
        overlays.set(t, "buy");
        break;
      case "EXIT": {
        const pnl = d.position?.realizedPnl ?? null;
        actions.sold.push({ ticker: t, pnl });
        if (pnl != null) {
          realized += pnl;
          hasAnyClose = true;
        }
        const outcome = d.position?.outcome;
        overlays.set(t, outcome === "LOSS" ? "closed-loss" : "closed-win");
        break;
      }
      case "PARTIAL_EXIT": {
        const pnl = d.position?.realizedPnl ?? null;
        actions.trimmed.push({ ticker: t, pnl });
        // PARTIAL_EXIT often reports cumulative pnl — don't double-count realized here.
        overlays.set(t, "sell");
        break;
      }
      case "HOLD":
        actions.held.push(t);
        // No overlay for hold — logo alone reads as "still there"
        break;
      case "WATCH":
        actions.watched.push(t);
        if (!overlays.has(t)) overlays.set(t, "watch");
        break;
      case "REMOVE_WATCH":
        actions.unwatched.push(t);
        if (!overlays.has(t)) overlays.set(t, "unwatch");
        break;
      case "PASS":
        actions.passed.push(t);
        break;
      default:
        // Unknown decision — silently skip; don't crash the feed.
        break;
    }
  }

  // ── Pass 2: PositionManagementActions for pure stop/target moves ──────
  // A capital-moving action (FULL_CLOSE / PARTIAL_CLOSE / ADD_TO_POSITION)
  // already surfaced via TradeDecision — skip those here to avoid double
  // counting. Only surface UPDATE_TARGETS / MOVE_STOP_TO_BREAKEVEN /
  // SET_TRAILING_STOP since those don't have a TradeDecision companion.
  const capitalActionTypes = new Set([
    "FULL_CLOSE",
    "PARTIAL_CLOSE",
    "ADD_TO_POSITION",
  ]);
  for (const a of run.managementActions) {
    if (capitalActionTypes.has(a.actionType)) continue;
    const ticker = a.position?.symbol?.toUpperCase();
    if (!ticker) continue;

    let what = "";
    if (a.actionType === "MOVE_STOP_TO_BREAKEVEN") {
      what = "stop → breakeven";
    } else if (a.actionType === "SET_TRAILING_STOP") {
      what = a.newTrailPct != null ? `trailing ${a.newTrailPct}%` : "trailing stop";
    } else if (a.actionType === "UPDATE_TARGETS") {
      const bits: string[] = [];
      if (a.newTargetPrice != null) bits.push(`target $${a.newTargetPrice}`);
      if (a.newStopLoss != null) bits.push(`stop $${a.newStopLoss}`);
      what = bits.length > 0 ? bits.join(", ") : "targets updated";
    } else {
      what = a.actionType.toLowerCase().replace(/_/g, " ");
    }

    // De-dup: if this ticker already has a capital action, skip — that's the headline.
    if (
      actions.bought.includes(ticker) ||
      actions.added.includes(ticker) ||
      actions.sold.some((s) => s.ticker === ticker) ||
      actions.trimmed.some((s) => s.ticker === ticker)
    ) {
      continue;
    }
    actions.managed.push({ ticker, what });
    // Don't overwrite existing overlays — a stop move on a HOLD shouldn't clobber the logo.
  }

  // ── Fallback: legacy runs with no TradeDecisions ──────────────────────
  const isLegacy = run.decisions.length === 0 && researched > 0;
  if (isLegacy) {
    for (const t of run.theses) {
      if (t.direction === "PASS") {
        actions.passed.push(t.ticker.toUpperCase());
      } else {
        actions.held.push(t.ticker.toUpperCase());
      }
    }
  }

  // De-duplicate ticker lists (a ticker can legitimately appear once per bucket only).
  actions.bought = dedupe(actions.bought);
  actions.added = dedupe(actions.added);
  actions.held = dedupe(actions.held);
  actions.watched = dedupe(actions.watched);
  actions.unwatched = dedupe(actions.unwatched);
  actions.passed = dedupe(actions.passed);

  return {
    actions,
    counts: {
      researched,
      new: actions.bought.length + actions.added.length,
      closed: actions.sold.length,
      held: actions.held.length,
      passed: actions.passed.length,
      watchlist: actions.watched.length + actions.unwatched.length,
      managed: actions.managed.length + actions.trimmed.length,
    },
    realizedPnl: hasAnyClose ? realized : null,
    isFailed,
    isLegacy,
    tickerOverlays: overlays,
  };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ── String formatters for the card ──────────────────────────────────────────

/**
 * The primary action line. Activity-feed vocabulary, grouped and truncated
 * for the feed card (detail pages get the full list). Passes are OMITTED
 * from this line per product decision — they dominate volume without
 * carrying information; counts still surface in the stats row.
 */
export function formatActionLine(summary: RunSummary): string {
  if (summary.isFailed) return "Failed — no analysis";

  const parts: string[] = [];

  if (summary.actions.bought.length > 0) {
    parts.push(`Bought ${summary.actions.bought.join(", ")}`);
  }
  if (summary.actions.added.length > 0) {
    parts.push(`Added to ${summary.actions.added.join(", ")}`);
  }
  if (summary.actions.sold.length > 0) {
    parts.push(
      summary.actions.sold
        .map((s) => `Sold ${s.ticker}${formatPnlSuffix(s.pnl)}`)
        .join(" · "),
    );
  }
  if (summary.actions.trimmed.length > 0) {
    parts.push(
      summary.actions.trimmed.map((s) => `Trimmed ${s.ticker}`).join(" · "),
    );
  }
  if (summary.actions.managed.length > 0) {
    parts.push(
      summary.actions.managed.map((m) => `${m.ticker} (${m.what})`).join(" · "),
    );
  }

  // If ZERO capital / management actions, surface the holds/watchlist as the
  // primary line instead of returning an empty string.
  if (parts.length === 0) {
    if (summary.actions.held.length > 0) {
      const n = summary.actions.held.length;
      return `No trades — ${n} hold${n !== 1 ? "s" : ""} reaffirmed`;
    }
    if (summary.counts.watchlist > 0) {
      // Watchlist-only run
      const bits: string[] = [];
      if (summary.actions.watched.length > 0) {
        bits.push(`Added ${summary.actions.watched.join(", ")} to watchlist`);
      }
      if (summary.actions.unwatched.length > 0) {
        bits.push(`Removed ${summary.actions.unwatched.join(", ")} from watchlist`);
      }
      return bits.join(" · ");
    }
    return "No actions taken";
  }

  // Holds as a soft suffix when present alongside actions.
  if (summary.actions.held.length > 0) {
    const head = summary.actions.held.slice(0, 3).join(", ");
    const extra =
      summary.actions.held.length > 3
        ? ` +${summary.actions.held.length - 3}`
        : "";
    parts.push(`Held ${head}${extra}`);
  }

  return parts.join(" · ");
}

function formatPnlSuffix(pnl: number | null | undefined): string {
  if (pnl == null) return "";
  const sign = pnl >= 0 ? "+" : "";
  return ` ${sign}$${Math.abs(Math.round(pnl)).toLocaleString("en-US")}`;
}

/**
 * Stats row — counts only. Drops "recommended" (the old lie) and
 * "avg confidence" (vanity in a feed). Omits zero-count segments so
 * low-activity runs don't get visually crowded.
 */
export function formatStatsRow(summary: RunSummary): string {
  const bits: string[] = [];
  bits.push(`${summary.counts.researched} researched`);
  if (summary.counts.new > 0) bits.push(`${summary.counts.new} new`);
  if (summary.counts.closed > 0) bits.push(`${summary.counts.closed} closed`);
  if (summary.counts.held > 0) bits.push(`${summary.counts.held} held`);
  if (summary.counts.passed > 0) bits.push(`${summary.counts.passed} passed`);
  return bits.join(" · ");
}
