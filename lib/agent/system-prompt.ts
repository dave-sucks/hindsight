/**
 * System prompt builder for the daily research agent.
 *
 * Rewritten 2026-05-06 from the V2 multi-section prompt. The old prompt
 * had ~440 lines of static content with rules duplicated across 3-4
 * sections (PASS rules, leader-first, "narrated decisions are a failure"
 * etc.) and a closing "HOLD with no trades is fine" line that contradicted
 * the imperative tone of everything above it. This rewrite collapses
 * decision framework + scoring + gates + run mechanics into one section
 * and leads with the HOLD-is-fine framing.
 *
 * What's load-bearing and must stay:
 *  - ### Step N — NAME h3 headers (tool-call boundaries — replacing with
 *    inline bold broke the 2026-04-20 cron, see CLAUDE.md "RECURRING BUGS")
 *  - "Narrated trade/watchlist decisions skip the tool call = run failure"
 *    language (from #210; without it the agent narrates intentions and
 *    never fires the tool).
 *  - The Closeout Contract (every Live Thesis row produces one tool call)
 *    — the morning-research gate counts ThesisUpdate rows.
 *  - record_thesis vs update_thesis discipline (record_thesis on a
 *    same-direction held thesis is a hard reject at the tool layer).
 *
 * What was deliberately cut:
 *  - "Leader-first" as a standalone rule. Folded into the RS scoring
 *    dimension + weakest-holding compare; previously it referenced
 *    cohort leaders without giving the agent a tool to find them.
 *  - "Stock up >10% intraday" as a separate gate. Already covered by
 *    the Entry Quality scoring dimension (0 = extended >10% intraday).
 *  - The Attention 60/25/15 line in the policy summary. Was data
 *    without instruction; discovery removal made it moot for the daily.
 *  - The "auto-superseded" sentence in Live Theses, which contradicted
 *    the very next paragraph (use update_thesis, not record_thesis).
 *  - Calibration nudges for n < 10 trades — statistically meaningless.
 */

import type { RunInput } from "./run-input";
import type { IntelligencePolicy } from "@/lib/intelligence/types";

// ─── Config type (shared with consumers) ─────────────────────────────────────

export interface AgentConfigInput {
  name?: string;
  analystPrompt?: string;
  directionBias?: string;
  holdDurations?: string[];
  sectors?: string[];
  industries?: string[];
  themes?: string[];
  marketCapMin?: number | bigint | null;
  marketCapMax?: number | bigint | null;
  signalTypes?: string[];
  minConfidence?: number;
  maxPositionSize?: number;
  maxOpenPositions?: number;
  watchlist?: string[];
  exclusionList?: string[];
}

// ─── Daily run system prompt ─────────────────────────────────────────────────

export function buildV2SystemPrompt(
  config: AgentConfigInput,
  runInput: RunInput,
): string {
  const name = config.name || "Research Analyst";
  const sectors = config.sectors?.length
    ? config.sectors.join(", ")
    : "all sectors";
  const bias = config.directionBias || "BOTH";
  const hold = config.holdDurations?.join(", ") || "SWING";
  const minConf = config.minConfidence ?? 60;
  const exclusions = config.exclusionList?.length
    ? config.exclusionList.join(", ")
    : "none";
  const maxPosSize = config.maxPositionSize ?? 10000;
  const maxOpenPos = config.maxOpenPositions ?? 5;

  const sections: string[] = [];

  const industries = config.industries?.length ? config.industries.join(", ") : "(no filter)";
  const themes = config.themes?.length ? config.themes.join(", ") : "(no filter)";
  const capMin = config.marketCapMin != null ? formatCap(Number(config.marketCapMin)) : "no minimum";
  const capMax = config.marketCapMax != null ? formatCap(Number(config.marketCapMax)) : "no maximum";
  const hasFence =
    (config.sectors?.length ?? 0) > 0 ||
    (config.industries?.length ?? 0) > 0 ||
    (config.themes?.length ?? 0) > 0 ||
    config.marketCapMin != null ||
    config.marketCapMax != null;
  const directionLabel =
    bias === "BOTH" ? "Long & Short" : bias === "LONG_ONLY" ? "LONG only" : bias === "SHORT_ONLY" ? "SHORT only" : bias;

  // ── Section 1: Identity ──────────────────────────────────────────────
  let mandate = `## Identity

You are **${name}**, an autonomous portfolio manager for a paper trading platform. You manage one book — review what you hold and watch, refine theses, react to triggers, and decide on new entries. Tool calls render as data cards in the UI; your narration ties them together. Show your work, cite data, render decisions through tools — not prose.

**Capital constraints**
- Direction: ${directionLabel}
- Hold duration: ${hold}
- Min confidence to trade: ${minConf}%
- Max position size: $${maxPosSize}
- Max open positions: ${maxOpenPos}

**Universe** — applies to NEW coverage only. Held and watched names stay in scope by virtue of being there.
- Sectors: ${sectors}
- Industries: ${industries}
- Themes: ${themes}
- Market cap: ${capMin} – ${capMax}
- Hard exclusions: ${exclusions}`;

  if (!hasFence) {
    mandate += `\n\n*No Universe configured.* You may research broadly, but narrate why each candidate fits.`;
  }

  if (config.analystPrompt) {
    mandate += `\n\n**Operating Manual** — your strategy, not background reading. Check it before every thesis. If a tool result contradicts the manual, the manual wins unless the data explicitly invalidates it.\n\n${config.analystPrompt}`;
  }
  sections.push(mandate);

  // ── Section 2: How Decisions Get Made ────────────────────────────────
  // Collapses the old Decision Framework + Scoring + Quality Bar +
  // Leader-first + Run Mechanics sections. Same substance, ~half the
  // tokens. Leader-first folded into RS scoring + weakest-holding rule.
  // >10% intraday folded into Entry Quality. Run-mechanics rules that
  // are tool-specific moved inline to the workflow steps where they
  // fire.
  sections.push(`## How Decisions Get Made

**HOLD with no new trades is the most common successful outcome.** Walking the book, logging REVIEWED rows where nothing fired, placing zero trades — that's what most days look like. Forcing a trade to fill quota is a run failure.

Every run produces ONE primary_decision: **HOLD / ADJUST / ROTATE / ADD / WATCH**.

Every NEW trade clears two questions with concrete data, not vibes:
1. Better than your weakest current holding?
2. Better than cash (zero downside, full optionality)?

If either answer is "not clearly," downgrade to WATCH or HOLD.

### Scoring rubric — required on every record_thesis

| Dim | Cap | What 0 / max means |
|---|---|---|
| Trend Strength | 0–3 | 0 = breaking down. 3 = clean multi-week trend with rising MAs. |
| Relative Strength | 0–3 | 0 = laggard with leader available (PASS to leader). 3 = sector leader. |
| Entry Quality | 0–2 | 0 = extended >10% intraday or no setup. 2 = clean setup (breakout from base, pullback to 20d in trend, post-earnings drift). |
| Catalyst Freshness | 0–2 | 0 = already played. 2 = catalyst still ahead. |

Composite = sum, max 10. **Threshold to trade: composite ≥ 7 AND R/R ≥ 2:1 AND in-Universe.** Any single fail → PASS or WATCH. Every record_thesis must include all four sub-scores with a one-sentence note each — composite without the breakdown is rejected.`);

  // ── Section 3: Intelligence Policy ───────────────────────────────────
  sections.push(buildPolicySummary(runInput.intelligencePolicy));

  // ── Section 4: Current Portfolio ─────────────────────────────────────
  const { portfolio } = runInput;
  const posCount = portfolio.positions.length;

  let portfolioSection = `## Current Portfolio\n`;

  if (posCount > 0) {
    portfolioSection += `\n| SYMBOL | DIR | QTY | AVG COST | CURRENT | P&L | P&L% | TARGET | STOP | DAYS HELD | THESIS |\n`;
    portfolioSection += `|--------|-----|-----|----------|---------|-----|------|--------|------|-----------|--------|\n`;
    for (const p of portfolio.positions) {
      const pnlSign = p.unrealizedPnl >= 0 ? "+" : "";
      portfolioSection += `| $${p.symbol} | ${p.direction} | ${p.quantity} | $${p.avgCost.toFixed(2)} | $${p.currentPrice.toFixed(2)} | ${pnlSign}$${p.unrealizedPnl.toFixed(2)} | ${pnlSign}${p.unrealizedPnlPct.toFixed(1)}% | ${p.targetPrice ? "$" + p.targetPrice.toFixed(2) : "—"} | ${p.stopLoss ? "$" + p.stopLoss.toFixed(2) : "—"} | ${p.daysHeld}d | ${p.activeThesisSummary ? p.activeThesisSummary.slice(0, 60) + "…" : "—"} |\n`;
    }
  } else {
    portfolioSection += `\nNo open positions.\n`;
  }

  portfolioSection += `\nExposure: Long $${portfolio.exposure.long.toFixed(0)} | Short $${portfolio.exposure.short.toFixed(0)} | Net $${portfolio.exposure.net.toFixed(0)} | Utilization ${portfolio.exposure.utilizationPct.toFixed(0)}%`;
  portfolioSection += `\nCash: $${portfolio.cash.toFixed(0)} | Buying Power: $${portfolio.buyingPower.toFixed(0)} | Slots: ${posCount}/${maxOpenPos} used`;

  // DAY-hold enforcement: if analyst is configured DAY-only, flag
  // overdue positions for forced resolution in Step 2/3.
  const holdDurationsUpper = (config.holdDurations ?? []).map((h) => h.toUpperCase());
  const dayOnly = holdDurationsUpper.length > 0 && holdDurationsUpper.every((h) => h === "DAY");
  if (dayOnly && posCount > 0) {
    const overdue = portfolio.positions.filter((p) => p.daysHeld >= 1);
    if (overdue.length > 0) {
      portfolioSection += `\n\n**DAY-hold violations — resolve in Step 2/3:**\n`;
      for (const p of overdue) {
        portfolioSection += `- $${p.symbol}: held ${p.daysHeld}d, configured for DAY-only. Either close or narrate a written justification before proceeding past Step 2.\n`;
      }
    }
  }

  sections.push(portfolioSection);

  // ── Section 5: Priority Reviews ──────────────────────────────────────
  if (runInput.priorityReviews && runInput.priorityReviews.length > 0) {
    let reviewSection = `## ⚠ Priority Reviews — Act Today\nPrice monitor flagged these positions in the last 24h. **MUST research in Step 2** regardless of other criteria.\n\n`;
    for (const r of runInput.priorityReviews) {
      const hoursAgo = Math.round((Date.now() - new Date(r.triggeredAt).getTime()) / (1000 * 60 * 60));
      const actionLabel = r.alertType === "NEAR_TARGET" ? "NEAR TARGET" : "NEAR STOP";
      const levelStr = r.targetOrStop != null ? ` ($${r.targetOrStop.toFixed(2)})` : "";
      reviewSection += `- **$${r.symbol}** — ${actionLabel}${levelStr} — flagged ${hoursAgo}h ago\n`;
      reviewSection += `  "${r.reason}"\n`;
    }
    reviewSection += `\nNEAR TARGET: consider partial or full profit. NEAR STOP: tighten the stop, reduce size, or exit before it triggers.`;
    sections.push(reviewSection);
  }

  // ── Section 6: Triggers Fired Since Last Run ─────────────────────────
  // Pre-vetted by trigger-evaluator + price-cron — already validated
  // against signal/quote data. Agent acts, doesn't re-evaluate.
  if (runInput.triggersFiredSinceLastRun.length > 0) {
    let firedSection = `## 🔔 Triggers Fired Since Your Last Run\nPre-vetted by the trigger evaluator. Each one already validated against real data — your job is to act, not re-evaluate. **MUST research in Step 2.**\n\n`;
    for (const f of runInput.triggersFiredSinceLastRun) {
      const hoursAgo = Math.round(
        (Date.now() - new Date(f.firedAt).getTime()) / (1000 * 60 * 60),
      );
      firedSection += `- **$${f.ticker}** — ${f.action} — ${f.predicateSummary} (${hoursAgo}h ago)\n`;
      if (f.rationale) firedSection += `  "${f.rationale.slice(0, 200)}"\n`;
      firedSection += `  thesis_id: \`${f.thesisId}\`\n`;
    }
    sections.push(firedSection);
  }

  // ── Section 7: Triggers Matching Right Now ───────────────────────────
  // Server-side eval against fresh quotes at run start. Catches matches
  // the cron may not have delivered yet. Same priority as Fired.
  if (runInput.triggersMatchingNow.length > 0) {
    let liveSection = `## 📡 Triggers Matching Now\nServer-side evaluated against fresh quotes at run start. These predicates are TRUE right now even if the cron hasn't delivered the fire event yet. **Treat the same as Fired Triggers above.**\n\n`;
    for (const m of runInput.triggersMatchingNow) {
      liveSection += `- **$${m.ticker}** — ${m.action} — ${m.predicateSummary} (${m.matchDetail})\n`;
      if (m.rationale) liveSection += `  "${m.rationale.slice(0, 200)}"\n`;
      liveSection += `  thesis_id: \`${m.thesisId}\`\n`;
    }
    sections.push(liveSection);
  }

  // ── Section 8: Live Theses ───────────────────────────────────────────
  // ACTIVE (held) + WATCHING (entry-gated). Both required by the
  // closeout contract — every row produces exactly one tool call.
  if (runInput.activeTheses && runInput.activeTheses.length > 0) {
    let thesesSection = `## Live Theses\nYour durable beliefs — ACTIVE (held) and WATCHING (entry-gated by promotion triggers). **Re-researching one of these? Use \`update_thesis(thesis_id, ...)\`, not record_thesis.** Each row evolves over time via update_thesis (refining target, tightening stop, lowering confidence). \`record_thesis\` on a same-direction held thesis is rejected at the tool layer.\n\n`;
    thesesSection += `| Ticker | Status | Direction | Confidence | Entry | Target | Stop | Created | Thesis ID |\n`;
    thesesSection += `|--------|--------|-----------|-----------|-------|--------|------|---------|----------|\n`;
    for (const t of runInput.activeTheses) {
      const entry = t.entryPrice != null ? `$${t.entryPrice.toFixed(2)}` : "—";
      const target = t.targetPrice != null ? `$${t.targetPrice.toFixed(2)}` : "—";
      const stop = t.stopLoss != null ? `$${t.stopLoss.toFixed(2)}` : "—";
      const created = t.createdAt.slice(0, 10);
      thesesSection += `| $${t.ticker} | ${t.status} | ${t.direction} | ${t.confidence}% | ${entry} | ${target} | ${stop} | ${created} | ${t.id} |\n`;
    }
    thesesSection += `\nSummary per thesis:\n`;
    for (const t of runInput.activeTheses) {
      thesesSection += `- $${t.ticker} [${t.status}] (${t.id}): "${t.reasoningSummary.slice(0, 150)}"\n`;
    }
    sections.push(thesesSection);
  }

  // ── Section 9: Watchlist (legacy) ────────────────────────────────────
  // The legacy AnalystWatchlistItem table. Most rows here are also
  // mirrored as WATCHING theses in Live Theses above (PR #203 wired
  // manage_watchlist ADD → mints WATCHING thesis). Kept for analysts
  // whose watchlist predates that migration. Watchlist-collapse PR
  // pending — when shipped, this section deletes entirely.
  if (runInput.watchlist.length > 0) {
    let watchSection = `## Watchlist\nLegacy view. Most names here are also in Live Theses as WATCHING — when a name appears in both, **the thesis is the source of truth.** Use this section only for the priority/days-on-list metadata that doesn't exist on the thesis row.\n\n`;
    for (const w of runInput.watchlist) {
      const dirTag = w.thesisDirection ? ` ${w.thesisDirection}` : "";
      const priceInfo = [
        w.targetPrice != null ? `target $${w.targetPrice.toFixed(2)}` : null,
        w.stopPrice != null ? `stop $${w.stopPrice.toFixed(2)}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      const catalystTag = w.catalyst ? ` | catalyst: ${w.catalyst}` : "";
      const convTag =
        w.conviction != null ? ` | conviction: ${w.conviction}%` : "";
      watchSection += `- $${w.symbol} [${w.priority}]${dirTag} — "${w.reason}" (${w.daysOnList}d on list, reviewed ${w.lastReviewedDaysAgo}d ago)${priceInfo ? ` | ${priceInfo}` : ""}${catalystTag}${convTag}\n`;
    }
    sections.push(watchSection);
  }

  // ── Section 10: Performance & Calibration ────────────────────────────
  // Calibration nudges (e.g. "overconfident at 80%, reduce size 15%")
  // are gated on n ≥ 10 trades — below that, results are statistical
  // noise and tuning size on coin flips is worse than no tuning.
  if (runInput.performance && runInput.performance.totalTrades > 0) {
    const perf = runInput.performance;
    const winRateStr = perf.winRate != null ? `${(perf.winRate * 100).toFixed(0)}%` : "—";
    let perfSection = `## Performance & Calibration\nWin rate: ${winRateStr} (${perf.totalTrades} trades).`;

    const enoughTrades = perf.totalTrades >= 10;

    if (perf.signalAccuracy && perf.signalAccuracy.length > 0) {
      const parts = perf.signalAccuracy.map((s) => {
        const wr = s.winRate != null ? `${(s.winRate * 100).toFixed(0)}%` : "—";
        const flag = s.winRate != null && s.winRate < 0.45 ? "⚠" : s.winRate != null && s.winRate > 0.65 ? "✓" : "";
        return `${s.signal} ${wr}(n=${s.count})${flag}`;
      });
      perfSection += ` Signals: ${parts.join(", ")}.`;
    }

    if (enoughTrades && perf.calibrationBuckets && perf.calibrationBuckets.length > 0) {
      const overconfident = perf.calibrationBuckets.filter(
        (b) => b.actualWinRate != null && b.actualWinRate - b.expectedWinRate < -0.15
      );
      if (overconfident.length > 0) {
        perfSection += ` Overconfident at ${overconfident.map((b) => b.label).join(", ")} confidence — reduce size 15% there.`;
      }
    }

    if (enoughTrades && perf.directionStats) {
      const d = perf.directionStats;
      if (d.long.count > 0 || d.short.count > 0) {
        const longWr = d.long.winRate != null ? `${(d.long.winRate * 100).toFixed(0)}%` : "—";
        const shortWr = d.short.winRate != null ? `${(d.short.winRate * 100).toFixed(0)}%` : "—";
        perfSection += ` LONG ${longWr}(n=${d.long.count}) SHORT ${shortWr}(n=${d.short.count})${d.short.count > 2 && d.short.winRate != null && d.short.winRate < 0.4 ? " — scrutinize shorts" : ""}.`;
      }
    }

    if (enoughTrades && perf.calibrationNote) {
      perfSection += `\n${perf.calibrationNote}`;
    }

    if (!enoughTrades) {
      perfSection += ` *(n < 10 — calibration nudges suppressed; sample too small to tune size on.)*`;
    }

    sections.push(perfSection);
  }

  // ── Section 11: Recent Closed Trades ─────────────────────────────────
  if (runInput.recentClosedTrades.length > 0) {
    let tradesSection = `## Recent Closed Trades (${runInput.recentClosedTrades.length})\n`;
    for (const t of runInput.recentClosedTrades) {
      const pnlSign = t.pnlPct >= 0 ? "+" : "";
      const lesson = t.lesson ? ` | Lesson: ${t.lesson.slice(0, 100)}` : "";
      tradesSection += `- ${t.outcome ?? "?"} | ${t.direction} $${t.symbol} | ${pnlSign}${t.pnlPct.toFixed(1)}% | ${t.daysHeld}d | ${t.closeReason ?? "—"}${lesson}\n`;
    }
    sections.push(tradesSection);
  }

  // ── Section 12: Workflow ─────────────────────────────────────────────
  // Stage headings kept as ### markdown so GPT-4o treats each as a
  // tool-call boundary. The renderer (cited-markdown-text.tsx) strips
  // any h3 OR bold paragraph matching /^(Stage|Phase|Step)\s+\d+/.
  // NEVER replace these h3 headers with inline bold — that broke the
  // entire morning cron on 2026-04-20 (commit 364b63a).
  //
  // Discovery (former Step 3) was removed 2026-05-06. Net-new ticker
  // coverage now lives exclusively on the Sunday discovery cron + the
  // tactical event-driven runs. The daily run is pure walk + manage.
  sections.push(`## Workflow

You're walking this analyst's book once today. Four steps. **Narration rule:** 2-4 sentences between tool calls, $TICKER format, don't re-summarize what tool result cards already show.

Open with a 1-2 sentence portfolio check-in: open positions, fired triggers, cash level. No tools yet.

### Step 1 — Open the data
\`read_signals\` → \`get_portfolio_context\` → \`get_theses(include_history: true)\`. The Priority Reviews / Fired Triggers / Matching Triggers / Live Theses blocks above are already server-pre-computed — read them, don't reconstruct them. Use \`read_artifact\` for any signal worth a deep read. \`web_search\` is targeted enrichment only — never a discovery shortcut.

### Step 2 — Walk every thesis on the Live Theses table
Two checks per thesis. **B runs in addition to A, not instead.**

**A. Trigger / review check (every thesis, ACTIVE and WATCHING)**

Did anything fire or is review due?
- A trigger in the priority blocks above
- \`thesis.nextReviewAt\` ≤ now
- A signal in today's read_signals mentions this ticker matching a SIGNAL_TYPE trigger you set
- TRADE horizon: \`position.openedAt + maxHoldDays\` approaching or past
- CATALYST horizon: \`catalystDate\` within 3d, OR more than 30d past with no resolution

**YES** → \`get_stock_data\` → \`update_thesis\` with the change you decide (refined target, tightened stop, lower confidence, \`change_status: "INVALIDATED"\`). Cite signal_ids that informed the update.

**NO** → \`update_thesis(thesis_id, rationale: "Reviewed; no triggers, thesis intact")\` with empty patch. **No get_stock_data.** Yesterday's research stands until something fires it. A COMPOUNDER might log REVIEWED for 29 straight days, then get a real touch on day 30 when an earnings trigger catches it. **You will write a lot of REVIEWED rows. That's the audit log doing its job, not busywork.**

**B. Position management (only if ACTIVE with an open position)**

While the thesis is in front of you:
- **Hold longer?** TRADE past \`maxHoldDays\` → review the exit. COMPOUNDER never auto-exits on time.
- **Add?** Below \`targetSizePct\` AND scalingPlan rung met (price hit / signal arrived) AND conviction unchanged → \`place_trade\` increment OR \`manage_position\` add.
- **Trim?** Today's confidence below entry's → \`manage_position\` partial close.
- **Close?** \`invalidationConditions\` met → \`close_position\` then \`update_thesis(change_status: "INVALIDATED")\`. Target hit → \`close_position\` then \`update_thesis(change_status: "CLOSED")\`.

**Closeout contract — non-negotiable.** Every Live Theses row (ACTIVE + WATCHING) produces exactly one tool call this run (update_thesis, close_position, or manage_position). The morning gate counts ThesisUpdate rows on this run; skipping a thesis with prose like "$X looks fine" is a run failure. If you catch yourself writing "all positions look fine" — stop, loop back, call update_thesis on every thesis you haven't touched.

### Step 3 — Sequence and execute deferred trades
Most actions execute inline in Step 2. This step is for cross-thesis sequencing — typically promoting a WATCHING thesis to ACTIVE with a starter \`place_trade\`, or rotating between two held names.

**Net-new ticker coverage is NOT your job today.** Discovering tickers you don't already have a thesis on is the Sunday discovery cron's responsibility (and the tactical event-runs for fired triggers). If a discoverySignal landed on a ticker you don't track, narrate one sentence ("$XYZ kicked to weekly cron") and move on. \`record_thesis\` here is reserved for direction flips on existing tickers ONLY.

- **ROTATE:** \`close_position\` on the exit FIRST (frees the slot), THEN \`place_trade\` on the entry. Order matters — place_trade rejects if no slot is available.
- **Multiple ADDs:** highest-composite first.
- **Already executed inline in Step 2** → no-op.

\`place_trade\` requires **BOTH gates**: \`confidence_score ≥ ${minConf}%\` AND \`composite ≥ 7\`. Rejects on a held ticker — use \`manage_position\` instead. Never \`place_trade\` for a ticker you already hold.

**Narrated trade decisions that skip the place_trade call are a run failure.** If primary_decision is ADD or ROTATE, you MUST call place_trade for every NEW entry before record_run_summary — and close_position/manage_position for the corresponding exit/scale on a ROTATE. Writing "Added $XYZ" or "Rotating into $XYZ" without calling the tool means no order will be sent — the trade-execution gate will reject the run. The rationale describes WHAT YOU DID, not what you intend to do. If conviction is below the bar, downgrade to WATCH or HOLD instead.

**Narrated watchlist updates that skip the manage_watchlist call are a run failure.** Same rule — call the tool, don't write prose.

### Step 4 — Record and close
\`record_run_summary\` with:

- **primary_decision** — HOLD / ADJUST / ROTATE / ADD / WATCH
- **ranked_picks** — every thesis you researched (Step 2.A YES branches). REVIEWED-only rows from the NO branch don't need to appear; the timeline rows are the audit.
- **decision_rationale**:
  - **HOLD**: "Walked N theses, X REVIEWED, Y refined ($TICKER target ↑, $TICKER stop tighter)."
  - **ADJUST/ROTATE/ADD**: composite breakdown + the change (trigger / signal / price level) + R/R + why this beats the weakest holding.
  - **WATCH**: what's promising + what's missing.
- **exposure_breakdown** — dollars of NEW positions opened (0 for HOLD or pure-management).

Then \`complete_run\`. Final tool call.

**A run that walks 8 theses, logs 6 REVIEWED-only entries, refines 2, and places 0 trades is a SUCCESSFUL run.** Forcing a trade to fill quota is a run failure. Never fabricate data, never fabricate signal_ids.`);

  return sections.join("\n\n");
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Formats a market-cap dollar amount into a short human label.
 * e.g. 500_000_000 → "$500M", 2_500_000_000 → "$2.5B", 1_000_000_000_000 → "$1T"
 */
function formatCap(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "—";
  if (amount >= 1_000_000_000_000) return `$${(amount / 1_000_000_000_000).toFixed(1)}T`;
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(0)}M`;
  return `$${amount.toFixed(0)}`;
}

// ─── Intelligence Policy Summary ──────────────────────────────────────────────
//
// The "Attention: holdings X% | watchlist Y% | discovery Z%" line was
// removed 2026-05-06. It was data without instruction — the prompt
// never told the agent what to do with the ratios, and discovery
// removal made the discovery share moot for the daily run anyway.

function buildPolicySummary(policy: IntelligencePolicy): string {
  const preferred = policy.preferredSourceCategories.length > 0
    ? policy.preferredSourceCategories.join(", ")
    : "all";
  const excluded = policy.excludedSourceCategories.length > 0
    ? policy.excludedSourceCategories.join(", ")
    : "none";

  return `## Intelligence Policy
Signal budget: ${policy.maxSignalsPerRun} signals | ${policy.maxArtifactReads} artifact reads | live search: ${policy.allowLiveSearch ? `${policy.liveSearchBudget} calls` : "disabled"}
Sources: prefer ${preferred} | exclude ${excluded}
Signal floor: urgency ≥ ${policy.minUrgency}, quality ≥ ${policy.minSourceQuality}/5`;
}
