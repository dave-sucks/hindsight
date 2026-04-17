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

/**
 * Color tokens for action badges on logos and inline dots.
 * The UI maps these to concrete Tailwind colors:
 *   green → bought / added
 *   red   → sold / trimmed
 *   blue  → watched / unwatched
 *   muted → held / passed / managed
 * The `partial` flag switches the rendered indicator from solid to
 * dashed/outlined — signals a partial capital change (ADD,
 * PARTIAL_EXIT, REMOVE_WATCH) rather than a full one.
 */
export type ActionColor = "green" | "red" | "blue" | "muted";

/** Legacy overlay keys kept only for consumers still using icons. Prefer ActionColor. */
export type RunActionIcon =
  | "buy"
  | "sell"
  | "watch"
  | "unwatch"
  | "closed-win"
  | "closed-loss"
  | "failed";

/**
 * One rendered chunk of the action line. The page maps these into spans
 * with a leading colored dot + text label. Segments are concatenated with
 * " · " separators.
 */
export interface ActionSegment {
  color: ActionColor;
  partial: boolean;
  text: string;
}

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
  /**
   * Per-ticker colored-ring badge for the logo stack. The UI renders a
   * ring around each logo using these tokens. `partial` → dashed ring.
   * Tickers with no entry here render with no ring (plain logo).
   */
  tickerBadges: Map<string, { color: ActionColor; partial: boolean }>;
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

  const badges = new Map<string, { color: ActionColor; partial: boolean }>();
  const badgePriority = new Map<string, number>();
  let realized = 0;
  let hasAnyClose = false;

  // ── Pass 1: TradeDecisions (authoritative per-ticker action) ──────────
  // Precedence when multiple events hit one ticker: capital-moving events
  // (INITIATE/ADD/EXIT/PARTIAL_EXIT) dominate soft actions (WATCH/HOLD),
  // and full actions dominate partials from the same color family.
  const setBadge = (
    t: string,
    color: ActionColor,
    partial: boolean,
    priority: number,
  ) => {
    const current = badgePriority.get(t) ?? 0;
    if (current >= priority) return;
    badges.set(t, { color, partial });
    badgePriority.set(t, priority);
  };

  for (const d of run.decisions) {
    const t = d.symbol.toUpperCase();
    switch (d.decision) {
      case "INITIATE":
        actions.bought.push(t);
        setBadge(t, "green", false, 100);
        break;
      case "ADD":
        actions.added.push(t);
        setBadge(t, "green", true, 90);
        break;
      case "EXIT": {
        const pnl = d.position?.realizedPnl ?? null;
        actions.sold.push({ ticker: t, pnl });
        if (pnl != null) {
          realized += pnl;
          hasAnyClose = true;
        }
        setBadge(t, "red", false, 100);
        break;
      }
      case "PARTIAL_EXIT": {
        const pnl = d.position?.realizedPnl ?? null;
        actions.trimmed.push({ ticker: t, pnl });
        setBadge(t, "red", true, 90);
        break;
      }
      case "HOLD":
        actions.held.push(t);
        // No badge for HOLD — logo alone reads as "still there."
        break;
      case "WATCH":
        actions.watched.push(t);
        setBadge(t, "blue", false, 50);
        break;
      case "REMOVE_WATCH":
        actions.unwatched.push(t);
        setBadge(t, "blue", true, 50);
        break;
      case "PASS":
        actions.passed.push(t);
        break;
      default:
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
    tickerBadges: badges,
  };
}

// ── Structured action segments (JSX-friendly) ───────────────────────────────

/**
 * Build the ordered list of action segments for rendering. The page
 * renders each segment as a leading colored dot + text, separated by
 * " · ". Passes are intentionally omitted — they dominate volume
 * without adding information; counts still surface in the stats row.
 *
 * When the run has zero capital actions and zero managed actions, we
 * fall back to a single neutral segment describing holds or watch-only
 * activity — so a quiet run reads as "No trades — 4 holds reaffirmed"
 * instead of an empty card.
 */
export function buildActionSegments(summary: RunSummary): ActionSegment[] {
  if (summary.isFailed) {
    return [{ color: "muted", partial: false, text: "Failed — no analysis" }];
  }

  const segments: ActionSegment[] = [];

  if (summary.actions.bought.length > 0) {
    segments.push({
      color: "green",
      partial: false,
      text: `Bought ${summary.actions.bought.join(", ")}`,
    });
  }
  if (summary.actions.added.length > 0) {
    segments.push({
      color: "green",
      partial: true,
      text: `Added to ${summary.actions.added.join(", ")}`,
    });
  }
  for (const sold of summary.actions.sold) {
    segments.push({
      color: "red",
      partial: false,
      text: `Sold ${sold.ticker}${formatPnlSuffix(sold.pnl)}`,
    });
  }
  for (const trim of summary.actions.trimmed) {
    segments.push({
      color: "red",
      partial: true,
      text: `Trimmed ${trim.ticker}`,
    });
  }
  for (const mgmt of summary.actions.managed) {
    segments.push({
      color: "muted",
      partial: false,
      text: `${mgmt.ticker} (${mgmt.what})`,
    });
  }

  // Zero-action fallbacks — make stasis read honestly.
  if (segments.length === 0) {
    if (summary.actions.held.length > 0) {
      const n = summary.actions.held.length;
      return [
        {
          color: "muted",
          partial: false,
          text: `No trades — ${n} hold${n !== 1 ? "s" : ""} reaffirmed`,
        },
      ];
    }
    if (summary.counts.watchlist > 0) {
      if (summary.actions.watched.length > 0) {
        segments.push({
          color: "blue",
          partial: false,
          text: `Added ${summary.actions.watched.join(", ")} to watchlist`,
        });
      }
      if (summary.actions.unwatched.length > 0) {
        segments.push({
          color: "blue",
          partial: true,
          text: `Removed ${summary.actions.unwatched.join(", ")} from watchlist`,
        });
      }
      return segments;
    }
    return [{ color: "muted", partial: false, text: "No actions taken" }];
  }

  // Holds as a soft trailing segment when the run also had real actions.
  if (summary.actions.held.length > 0) {
    const head = summary.actions.held.slice(0, 3).join(", ");
    const extra =
      summary.actions.held.length > 3 ? ` +${summary.actions.held.length - 3}` : "";
    segments.push({
      color: "muted",
      partial: false,
      text: `Held ${head}${extra}`,
    });
  }

  return segments;
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ── String formatters for the card ──────────────────────────────────────────

/**
 * Plain-string action line — thin wrapper over buildActionSegments.
 * Useful for SSR fallbacks, screen-reader aria-labels, and anywhere a
 * single string (vs rendered JSX with colored dots) is needed.
 */
export function formatActionLine(summary: RunSummary): string {
  return buildActionSegments(summary)
    .map((s) => s.text)
    .join(" · ");
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
