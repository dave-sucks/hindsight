/**
 * run-summary.ts — truthful summaries for the /runs feed cards.
 *
 * Single source of truth for "what did this run actually do?"
 *
 * In the new (post-PR3) model, every run produces ZERO OR MORE per-ticker
 * events of these kinds, in priority order:
 *
 *   Capital events (TradeDecision):
 *     INITIATE     → "Bought $X"            (green, full)
 *     ADD          → "Added to $X"          (green, partial)
 *     EXIT         → "Sold $X +N%"          (red,   full)
 *     PARTIAL_EXIT → "Trimmed $X"           (red,   partial)
 *
 *   Lifecycle events (ThesisUpdate, agent-written):
 *     INVALIDATED  → "Invalidated $X"       (red,   full)
 *     UPDATED      → "Updated $X"           (muted, full)
 *     REVIEWED     → "Reviewed N theses"    (muted, full, aggregate count only)
 *     CREATED w/ status=WATCHING → "Watching $X"  (blue,  full)
 *
 *   Management events (PositionManagementAction, no TradeDecision):
 *     UPDATE_TARGETS         → "Adjusted targets for $X"
 *     MOVE_STOP_TO_BREAKEVEN → "Moved stops to breakeven on $X"
 *     SET_TRAILING_STOP      → "Set trailing stops on $X"
 *
 * One ticker → one event slot, capital wins over lifecycle wins over
 * management. Never double-bills.
 *
 * isFailed = run.status === 'FAILED'. No heuristics.
 *
 * Stats line:
 *   N walked = distinct tickers with any event this run
 *   N triggered = TRIGGER_FIRED audit rows (system-written)
 *   N trade = capital events
 *   $X realized = sum of EXIT realizedPnl
 */

// ── Input shape (loose — accepts any superset of these fields) ──────────────

export interface RunSummaryInputTheses {
  ticker: string;
  direction: string | null;
  /**
   * Composite score JSONB (`{ trendStrength, relativeStrength, entryQuality,
   * catalystFreshness, composite }` — see `record_thesis`'s scoring arg).
   * PR-9 dropped the standalone `confidenceScore` int — `scoring.composite`
   * (0-10 scale) is the single conviction number. `unknown` since callers
   * pass Prisma's `JsonValue`; readers crack the shape via
   * `getThesisComposite()` from `lib/agent/thesis-narrative`.
   */
  scoring: unknown;
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

export interface RunSummaryInputThesisUpdate {
  type: string;
  thesis: { ticker: string; status: string } | null;
}

export interface RunSummaryInput {
  status: string;
  theses: RunSummaryInputTheses[];
  decisions: RunSummaryInputTradeDecision[];
  managementActions: RunSummaryInputManagementAction[];
  /** ThesisUpdate audit rows tied to this runId. Drives lifecycle verbs
   *  + the triggered/walked stats. Pass an empty array if not yet wired
   *  on a particular caller — we degrade cleanly. */
  thesisUpdates?: RunSummaryInputThesisUpdate[];
  /**
   * ResearchRun.mode — drives mode-specific summary shapes. Specifically
   * THESIS_WRITER runs are a single-ticker single-decision shape; the
   * daily-run "walked N theses" headline doesn't apply, and the empty-
   * state fallback ("No theses to walk") is wrong for them. Optional
   * for backwards-compat — callers that omit it land in the legacy
   * daily-run path.
   */
  mode?: string | null;
  /**
   * ResearchRun.parameters — opaque JSON. Typed as `unknown` because
   * Prisma's `JsonValue` is wider than `Record<string, unknown>` (it
   * can be a scalar or array at the top level). THESIS_WRITER reads
   * `ticker`, `mode`, `error` defensively inside buildActionSegments.
   */
  parameters?: unknown;
}

// ── Output shape ────────────────────────────────────────────────────────────

export type ActionColor = "green" | "red" | "blue" | "muted";

/** Legacy overlay keys kept only for consumers still using icons. */
export type RunActionIcon =
  | "buy"
  | "sell"
  | "watch"
  | "unwatch"
  | "closed-win"
  | "closed-loss"
  | "failed";

export interface ActionSegment {
  color: ActionColor;
  partial: boolean;
  text: string;
}

export interface TickerResult {
  ticker: string;
  pnl?: number | null;
}

export interface RunSummary {
  /**
   * ResearchRun.mode passthrough — drives mode-specific summary shapes
   * in buildActionSegments. Daily-run shape is the default; THESIS_WRITER
   * has its own single-ticker line. Null/undefined falls through to
   * legacy behavior.
   */
  mode?: string | null;
  /** ResearchRun.parameters passthrough — THESIS_WRITER reads ticker/mode/error defensively. */
  parameters?: unknown;
  /** Per-bucket ticker lists. One ticker appears in at most one bucket. */
  actions: {
    bought: string[];                 // INITIATE
    added: string[];                  // ADD
    sold: TickerResult[];             // EXIT (with $ pnl if closed)
    trimmed: TickerResult[];          // PARTIAL_EXIT
    invalidated: string[];            // ThesisUpdate(INVALIDATED)
    updated: string[];                // ThesisUpdate(UPDATED|STATUS_CHANGED)
    watching: string[];               // ThesisUpdate(CREATED) for WATCHING (or WATCH decision)
    reviewed: string[];               // ThesisUpdate(REVIEWED), aggregated as count only
    targetsAdjusted: string[];        // UPDATE_TARGETS
    stopsToBreakeven: string[];       // MOVE_STOP_TO_BREAKEVEN
    trailingStops: string[];          // SET_TRAILING_STOP
  };
  /** Aggregate counts. The "walked" stat is the headline of the stats row. */
  counts: {
    walked: number;        // distinct tickers with any event
    triggered: number;     // TRIGGER_FIRED audit rows count
    traded: number;        // capital decisions (INITIATE/ADD/EXIT/PARTIAL_EXIT)
    reviewed: number;      // REVIEWED audit rows count (subset of walked)
  };
  /** Sum of realized P&L from EXIT decisions in this run. Null when none. */
  realizedPnl: number | null;
  /** True only when run.status==='FAILED'. No more heuristics. */
  isFailed: boolean;
  /** Per-ticker logo badge, drives the colored ring on the logo stack. */
  tickerBadges: Map<string, { color: ActionColor; partial: boolean }>;
}

// ── Builder ─────────────────────────────────────────────────────────────────

export function buildRunSummary(run: RunSummaryInput): RunSummary {
  const actions: RunSummary["actions"] = {
    bought: [],
    added: [],
    sold: [],
    trimmed: [],
    invalidated: [],
    updated: [],
    watching: [],
    reviewed: [],
    targetsAdjusted: [],
    stopsToBreakeven: [],
    trailingStops: [],
  };
  const badges = new Map<string, { color: ActionColor; partial: boolean }>();
  // One bucket per ticker. Higher priority wins.
  const claimed = new Map<string, number>();
  const claim = (ticker: string, priority: number): boolean => {
    const current = claimed.get(ticker) ?? -1;
    if (current >= priority) return false;
    claimed.set(ticker, priority);
    return true;
  };
  const setBadge = (
    ticker: string,
    color: ActionColor,
    partial: boolean,
  ) => {
    badges.set(ticker, { color, partial });
  };

  let realized = 0;
  let hasAnyClose = false;
  let triggered = 0;

  // Priority ladder (higher wins):
  //   100 EXIT / INITIATE       (capital, terminal)
  //    90 ADD / PARTIAL_EXIT    (capital, partial)
  //    80 INVALIDATED           (lifecycle terminal)
  //    70 UPDATED / STATUS      (lifecycle non-terminal)
  //    60 management verb       (target / breakeven / trailing)
  //    50 WATCHING / CREATED    (new candidate)
  //    40 REVIEWED              (count only — never seizes a ticker slot)

  // ── Capital events first (TradeDecision) ─────────────────────────────
  for (const d of run.decisions) {
    const t = d.symbol.toUpperCase();
    switch (d.decision) {
      case "INITIATE":
        if (claim(t, 100)) {
          actions.bought.push(t);
          setBadge(t, "green", false);
        }
        break;
      case "ADD":
        if (claim(t, 90)) {
          actions.added.push(t);
          setBadge(t, "green", true);
        }
        break;
      case "EXIT": {
        if (claim(t, 100)) {
          const pnl = d.position?.realizedPnl ?? null;
          actions.sold.push({ ticker: t, pnl });
          if (pnl != null) {
            realized += pnl;
            hasAnyClose = true;
          }
          setBadge(t, "red", false);
        }
        break;
      }
      case "PARTIAL_EXIT": {
        if (claim(t, 90)) {
          const pnl = d.position?.realizedPnl ?? null;
          actions.trimmed.push({ ticker: t, pnl });
          setBadge(t, "red", true);
        }
        break;
      }
      case "WATCH":
        if (claim(t, 50)) {
          actions.watching.push(t);
          setBadge(t, "blue", false);
        }
        break;
      // HOLD / PASS / REMOVE_WATCH intentionally produce no segment in the
      // new model. HOLD is the default state of an Active position; PASS
      // and REMOVE_WATCH are decisions about absence — neither is an event
      // worth its own line. They'll surface implicitly via the Walked stat.
      default:
        break;
    }
  }

  // ── Lifecycle events (ThesisUpdate) ──────────────────────────────────
  for (const u of run.thesisUpdates ?? []) {
    if (!u.thesis?.ticker) continue;
    const t = u.thesis.ticker.toUpperCase();

    if (u.type === "TRIGGER_FIRED") {
      triggered += 1;
      continue;
    }

    if (u.type === "INVALIDATED") {
      if (claim(t, 80)) {
        actions.invalidated.push(t);
        setBadge(t, "red", false);
      }
    } else if (u.type === "CLOSED") {
      // CLOSED audit rows track close_position — TradeDecision(EXIT) already
      // covered the capital side. Skip to avoid double-billing; the EXIT
      // segment already says everything that matters.
      continue;
    } else if (u.type === "UPDATED" || u.type === "STATUS_CHANGED") {
      if (claim(t, 70)) {
        actions.updated.push(t);
        setBadge(t, "muted", false);
      }
    } else if (u.type === "CREATED") {
      // New thesis row — was it minted as WATCHING or ACTIVE?
      // ACTIVE w/o paired INITIATE is unusual but possible (e.g., the agent
      // promotes-and-buys but the trade fails). Prefer status when present.
      if (u.thesis.status === "WATCHING") {
        if (claim(t, 50)) {
          actions.watching.push(t);
          setBadge(t, "blue", false);
        }
      }
      // CREATED+ACTIVE without a paired INITIATE is rare — fall through
      // and let the trade events claim the ticker if/when they arrive.
    } else if (u.type === "REVIEWED") {
      // Aggregate count only — never claims a ticker slot. A ticker with
      // a real action takes its action segment; reviewed only fires for
      // tickers whose ONLY event this run was REVIEWED.
      if (!actions.reviewed.includes(t)) actions.reviewed.push(t);
    }
  }

  // Reviewed list = tickers that ONLY had a REVIEWED row (no other claim).
  actions.reviewed = actions.reviewed.filter((t) => (claimed.get(t) ?? -1) < 0);

  // ── Management events (PositionManagementAction) ─────────────────────
  // Skip capital types — those came in via TradeDecision. Skip tickers
  // already claimed by capital or lifecycle events. Pick highest-priority
  // bucket per ticker (targets > breakeven > trailing).
  const capitalActionTypes = new Set([
    "FULL_CLOSE",
    "PARTIAL_CLOSE",
    "ADD_TO_POSITION",
  ]);
  const mgmtBucket = new Map<string, "targets" | "breakeven" | "trailing">();
  const mgmtPriority = { targets: 3, breakeven: 2, trailing: 1 };
  for (const a of run.managementActions) {
    if (capitalActionTypes.has(a.actionType)) continue;
    const t = a.position?.symbol?.toUpperCase();
    if (!t) continue;
    if ((claimed.get(t) ?? -1) >= 70) continue; // already claimed by something stronger
    let bucket: "targets" | "breakeven" | "trailing" | null = null;
    if (a.actionType === "UPDATE_TARGETS") bucket = "targets";
    else if (a.actionType === "MOVE_STOP_TO_BREAKEVEN") bucket = "breakeven";
    else if (a.actionType === "SET_TRAILING_STOP") bucket = "trailing";
    if (!bucket) continue;
    const existing = mgmtBucket.get(t);
    if (existing && mgmtPriority[existing] >= mgmtPriority[bucket]) continue;
    mgmtBucket.set(t, bucket);
  }
  for (const [ticker, bucket] of mgmtBucket) {
    if (!claim(ticker, 60)) continue;
    if (bucket === "targets") actions.targetsAdjusted.push(ticker);
    else if (bucket === "breakeven") actions.stopsToBreakeven.push(ticker);
    else actions.trailingStops.push(ticker);
  }

  // De-dupe (a ticker can't legitimately appear twice in one bucket; the
  // claim() ladder already prevents cross-bucket dupes).
  actions.bought = dedupe(actions.bought);
  actions.added = dedupe(actions.added);
  actions.invalidated = dedupe(actions.invalidated);
  actions.updated = dedupe(actions.updated);
  actions.watching = dedupe(actions.watching);

  const traded =
    actions.bought.length +
    actions.added.length +
    actions.sold.length +
    actions.trimmed.length;

  return {
    mode: run.mode ?? null,
    parameters: run.parameters ?? null,
    actions,
    counts: {
      walked: claimed.size + actions.reviewed.length,
      triggered,
      traded,
      reviewed: actions.reviewed.length,
    },
    realizedPnl: hasAnyClose ? realized : null,
    isFailed: run.status === "FAILED",
    tickerBadges: badges,
  };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ── Structured action segments (JSX-friendly) ───────────────────────────────

/**
 * Build the action line. One segment per event class, tickers grouped:
 *   "Bought NVDA, MSFT · Sold ASML +$120 · Updated AVGO · Reviewed 5"
 * The page renders each as a leading colored dot + text, joined by " · ".
 */
export function buildActionSegments(summary: RunSummary): ActionSegment[] {
  // ── THESIS_WRITER mode — single-ticker single-decision shape ──────────
  // The daily-run "walked N theses / no theses to walk" framing doesn't
  // apply. Surface ticker + mint/refresh + status. Status check happens
  // here (before `isFailed`) so failed thesis-writer rows say "Thesis
  // research failed on $TICKER" instead of the generic "Run failed".
  if (summary.mode === "THESIS_WRITER") {
    // Parameters is `unknown` (Prisma JsonValue is wider than a plain
    // record) — guard before indexing.
    const params: Record<string, unknown> =
      typeof summary.parameters === "object" &&
      summary.parameters !== null &&
      !Array.isArray(summary.parameters)
        ? (summary.parameters as Record<string, unknown>)
        : {};
    const tickerRaw = params.ticker;
    const ticker = typeof tickerRaw === "string" ? tickerRaw.toUpperCase() : null;
    const modeRaw = params.mode;
    const writerMode =
      modeRaw === "refresh" ? "refresh" : modeRaw === "mint" ? "mint" : null;

    if (summary.isFailed) {
      const errorRaw = params.error;
      const errStr = typeof errorRaw === "string" ? errorRaw : null;
      const rateLimit = errStr?.includes("rate limit") ?? false;
      return [
        {
          color: "muted",
          partial: false,
          text: ticker
            ? `Thesis research failed on $${ticker}${rateLimit ? " (rate limit)" : ""}`
            : "Thesis research failed",
        },
      ];
    }

    // RUNNING or COMPLETE — derive from theses-touched in this run.
    // A successful mint lands one CREATED in run.thesisUpdates; a successful
    // refresh lands UPDATED or REVIEWED. If we see those, the run completed.
    if (ticker) {
      // touched-in-this-run signal — if the writer landed a thesis, the
      // CREATED row is in actions.watching (for WATCHING status) or
      // bucketed into updated. Don't over-engineer the detection; the
      // status field on the run row drives the verb:
      //   COMPLETE  → "Wrote thesis on $X" / "Refreshed thesis on $X"
      //   RUNNING   → "Researching $X" (~3-4 min)
      //   anything else → "Thesis research on $X"
      // status is on the parent caller, not on RunSummary directly —
      // we infer from the action buckets: any action means COMPLETE,
      // otherwise RUNNING-ish.
      const hasAction =
        summary.actions.bought.length > 0 ||
        summary.actions.added.length > 0 ||
        summary.actions.watching.length > 0 ||
        summary.actions.updated.length > 0 ||
        summary.actions.invalidated.length > 0 ||
        summary.actions.reviewed.length > 0;
      if (hasAction) {
        return [
          {
            color: "blue",
            partial: false,
            text:
              writerMode === "refresh"
                ? `Refreshed thesis on $${ticker}`
                : `Wrote thesis on $${ticker}`,
          },
        ];
      }
      return [
        {
          color: "muted",
          partial: false,
          text: `Researching $${ticker} (deep research, ~3-4 min)`,
        },
      ];
    }
    // No ticker in parameters — degrade to a generic line.
    return [{ color: "muted", partial: false, text: "Thesis research" }];
  }

  if (summary.isFailed) {
    return [{ color: "muted", partial: false, text: "Run failed" }];
  }

  const segments: ActionSegment[] = [];
  const a = summary.actions;

  if (a.bought.length > 0) {
    segments.push({
      color: "green",
      partial: false,
      text: `Bought ${a.bought.join(", ")}`,
    });
  }
  if (a.added.length > 0) {
    segments.push({
      color: "green",
      partial: true,
      text: `Added to ${a.added.join(", ")}`,
    });
  }
  for (const sold of a.sold) {
    segments.push({
      color: "red",
      partial: false,
      text: `Sold ${sold.ticker}${formatPnlSuffix(sold.pnl)}`,
    });
  }
  for (const trim of a.trimmed) {
    segments.push({
      color: "red",
      partial: true,
      text: `Trimmed ${trim.ticker}`,
    });
  }
  if (a.invalidated.length > 0) {
    segments.push({
      color: "red",
      partial: false,
      text: `Invalidated ${a.invalidated.join(", ")}`,
    });
  }
  if (a.updated.length > 0) {
    segments.push({
      color: "muted",
      partial: false,
      text: `Updated ${a.updated.join(", ")}`,
    });
  }
  if (a.watching.length > 0) {
    segments.push({
      color: "blue",
      partial: false,
      text: `Watching ${a.watching.join(", ")}`,
    });
  }
  if (a.targetsAdjusted.length > 0) {
    segments.push({
      color: "muted",
      partial: false,
      text: `Adjusted targets for ${a.targetsAdjusted.join(", ")}`,
    });
  }
  if (a.stopsToBreakeven.length > 0) {
    segments.push({
      color: "muted",
      partial: false,
      text: `Moved stops to breakeven on ${a.stopsToBreakeven.join(", ")}`,
    });
  }
  if (a.trailingStops.length > 0) {
    segments.push({
      color: "muted",
      partial: false,
      text: `Set trailing stops on ${a.trailingStops.join(", ")}`,
    });
  }
  if (a.reviewed.length > 0) {
    const n = a.reviewed.length;
    const noun = n === 1 ? "thesis" : "theses";
    segments.push({
      color: "muted",
      partial: false,
      text: `Reviewed ${n} ${noun}`,
    });
  }

  if (segments.length === 0) {
    // Walked nothing AND not failed = quiet run; this happens when the
    // analyst has 0 active+watching theses (new analyst, cleaned book).
    return [{ color: "muted", partial: false, text: "No theses to walk" }];
  }
  return segments;
}

// ── String formatters for the card / aria labels ────────────────────────────

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
 * Stats row — concise aggregate counts. Always shown when walked > 0.
 *   "9 walked · 1 triggered · 2 trades · +$240"
 */
export function formatStatsRow(summary: RunSummary): string {
  const bits: string[] = [];
  bits.push(`${summary.counts.walked} walked`);
  if (summary.counts.triggered > 0) bits.push(`${summary.counts.triggered} triggered`);
  if (summary.counts.traded > 0) {
    const noun = summary.counts.traded === 1 ? "trade" : "trades";
    bits.push(`${summary.counts.traded} ${noun}`);
  }
  return bits.join(" · ");
}
