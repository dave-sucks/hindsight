/**
 * System prompt builder for the research agent.
 * V2: portfolio-first, 7-phase run contract with structured RunInput.
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
  signalTypes?: string[];
  minConfidence?: number;
  maxPositionSize?: number;
  maxOpenPositions?: number;
  watchlist?: string[];
  exclusionList?: string[];
}

// ─── V2 System Prompt ────────────────────────────────────────────────────────

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

  // ── Section 1: Identity ──────────────────────────────────────────────
  sections.push(`## Identity
You are ${name}, an autonomous AI portfolio manager for a paper trading platform.
You independently manage a portfolio — reviewing holdings, monitoring your watchlist, discovering new opportunities, and making paper trading decisions. You think out loud, explain your reasoning, cite your sources, and show your work.

Your tool calls render as rich data cards in the UI. Your text narration connects these visual elements into a coherent research story.`);

  if (config.analystPrompt) {
    sections.push(`\n### Your Strategy\n${config.analystPrompt}`);
  }

  // ── Section 2: Your Rules ────────────────────────────────────────────
  sections.push(`## Your Rules
- Direction bias: ${bias}
- Hold duration: ${hold}
- Focus sectors: ${sectors}
- Minimum confidence to trade: ${minConf}%
- Exclusion list (never trade): ${exclusions}
- Max position size: $${maxPosSize}
- Max open positions: ${maxOpenPos}`);

  // ── Section 2.5: Intelligence Policy ─────────────────────────────────
  const policy = runInput.intelligencePolicy;
  sections.push(buildPolicySummary(policy));

  // ── Section 3: Current Portfolio ─────────────────────────────────────
  const { portfolio } = runInput;
  const posCount = portfolio.positions.length;
  const slotsUsed = posCount;
  const slotsAvailable = maxOpenPos;

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
  portfolioSection += `\nCash: $${portfolio.cash.toFixed(0)} | Buying Power: $${portfolio.buyingPower.toFixed(0)} | Slots: ${slotsUsed}/${slotsAvailable} used`;

  sections.push(portfolioSection);

  // ── Section 3.5: Priority Reviews ────────────────────────────────────
  if (runInput.priorityReviews && runInput.priorityReviews.length > 0) {
    let reviewSection = `## ⚠ Priority Reviews — Act Today\nThe price monitor flagged the following positions in the last 24 hours. These are **MUST-research** in Stage 2 regardless of any other triage criteria:\n\n`;
    for (const r of runInput.priorityReviews) {
      const hoursAgo = Math.round((Date.now() - new Date(r.triggeredAt).getTime()) / (1000 * 60 * 60));
      const actionLabel = r.alertType === "NEAR_TARGET" ? "NEAR TARGET" : "NEAR STOP";
      const levelStr = r.targetOrStop != null ? ` ($${r.targetOrStop.toFixed(2)})` : "";
      reviewSection += `- **$${r.symbol}** — ${actionLabel}${levelStr} — flagged ${hoursAgo}h ago\n`;
      reviewSection += `  "${r.reason}"\n`;
    }
    reviewSection += `\nFor NEAR TARGET: consider taking partial or full profit. For NEAR STOP: decide whether to tighten the stop, reduce size, or exit before it triggers.`;
    sections.push(reviewSection);
  }

  // ── Section 3.75: Active Theses ───────────────────────────────────────
  if (runInput.activeTheses && runInput.activeTheses.length > 0) {
    let thesesSection = `## Active Theses\nThese are your current ACTIVE theses. When you record a new thesis for any of these tickers, the old one is automatically superseded — you do not need to pass parent_thesis_id.\n\n`;
    thesesSection += `| Ticker | Direction | Confidence | Entry | Target | Stop | Created | Thesis ID |\n`;
    thesesSection += `|--------|-----------|-----------|-------|--------|------|---------|----------|\n`;
    for (const t of runInput.activeTheses) {
      const entry = t.entryPrice != null ? `$${t.entryPrice.toFixed(2)}` : "—";
      const target = t.targetPrice != null ? `$${t.targetPrice.toFixed(2)}` : "—";
      const stop = t.stopLoss != null ? `$${t.stopLoss.toFixed(2)}` : "—";
      const created = t.createdAt.slice(0, 10);
      thesesSection += `| $${t.ticker} | ${t.direction} | ${t.confidence}% | ${entry} | ${target} | ${stop} | ${created} | ${t.id} |\n`;
    }
    thesesSection += `\nSummary per thesis:\n`;
    for (const t of runInput.activeTheses) {
      thesesSection += `- $${t.ticker} (${t.id}): "${t.reasoningSummary.slice(0, 150)}"\n`;
    }
    thesesSection += `\nWhen re-researching a holding, record_thesis will automatically supersede the prior thesis. No manual linking needed.`;
    sections.push(thesesSection);
  }

  // ── Section 4: Watchlist ─────────────────────────────────────────────
  if (runInput.watchlist.length > 0) {
    let watchSection = `## Watchlist (${runInput.watchlist.length} items)\n`;
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

  // ── Section 5: Prior Brief ───────────────────────────────────────────
  if (runInput.priorBrief) {
    const brief = runInput.priorBrief;
    let briefSection = `## Prior Brief (${brief.date})\n`;

    if (brief.marketPosture) {
      briefSection += `Market Posture: ${brief.marketPosture}\n`;
    }

    if (brief.watchTomorrow?.length) {
      briefSection += `\nWatch Tomorrow:\n`;
      for (const w of brief.watchTomorrow) {
        briefSection += `- $${w.symbol}: ${w.trigger} → ${w.suggestedAction}${w.priority === "HIGH" ? " [HIGH]" : ""}\n`;
      }
    }

    if (brief.unresolvedItems?.length) {
      briefSection += `\nUnresolved Items:\n`;
      for (const u of brief.unresolvedItems) {
        briefSection += `- ${u.item} — Impact: ${u.impact}${u.affectedPositions?.length ? ` — Affects: ${u.affectedPositions.map((s) => "$" + s).join(", ")}` : ""}\n`;
      }
    }

    if (brief.selfCorrections?.length) {
      briefSection += `\nSelf-Corrections:\n`;
      for (const s of brief.selfCorrections) {
        briefSection += `- Observation: ${s.observation} → Adjustment: ${s.adjustment}\n`;
      }
    }

    if (brief.strategyNotes) {
      briefSection += `\nStrategy Notes: ${brief.strategyNotes.slice(0, 300)}`;
    }

    briefSection += `\n\nNarrative (summary): ${brief.narrative.slice(0, 400)}`;
    sections.push(briefSection);
  }

  // ── Section 6: Performance & Calibration ─────────────────────────────
  if (runInput.performance) {
    const perf = runInput.performance;
    const winRateStr = perf.winRate != null ? `${(perf.winRate * 100).toFixed(0)}%` : "—";
    let perfSection = `## Performance & Calibration\nWin rate: ${winRateStr} (${perf.totalTrades} trades).`;

    if (perf.signalAccuracy && perf.signalAccuracy.length > 0) {
      const parts = perf.signalAccuracy.map((s) => {
        const wr = s.winRate != null ? `${(s.winRate * 100).toFixed(0)}%` : "—";
        const flag = s.winRate != null && s.winRate < 0.45 ? "⚠" : s.winRate != null && s.winRate > 0.65 ? "✓" : "";
        return `${s.signal} ${wr}(n=${s.count})${flag}`;
      });
      perfSection += ` Signals: ${parts.join(", ")}.`;
    }

    if (perf.calibrationBuckets && perf.calibrationBuckets.length > 0) {
      const overconfident = perf.calibrationBuckets.filter(
        (b) => b.actualWinRate != null && b.actualWinRate - b.expectedWinRate < -0.15
      );
      if (overconfident.length > 0) {
        perfSection += ` Overconfident at ${overconfident.map((b) => b.label).join(", ")} confidence — reduce size 15% there.`;
      }
    }

    if (perf.directionStats) {
      const d = perf.directionStats;
      if (d.long.count > 0 || d.short.count > 0) {
        const longWr = d.long.winRate != null ? `${(d.long.winRate * 100).toFixed(0)}%` : "—";
        const shortWr = d.short.winRate != null ? `${(d.short.winRate * 100).toFixed(0)}%` : "—";
        perfSection += ` LONG ${longWr}(n=${d.long.count}) SHORT ${shortWr}(n=${d.short.count})${d.short.count > 2 && d.short.winRate != null && d.short.winRate < 0.4 ? " — scrutinize shorts" : ""}.`;
      }
    }

    if (perf.calibrationNote) {
      perfSection += `\n${perf.calibrationNote}`;
    }

    sections.push(perfSection);
  }

  // ── Section 7: Recent Closed Trades ──────────────────────────────────
  if (runInput.recentClosedTrades.length > 0) {
    let tradesSection = `## Recent Closed Trades (${runInput.recentClosedTrades.length})\n`;
    for (const t of runInput.recentClosedTrades) {
      const pnlSign = t.pnlPct >= 0 ? "+" : "";
      const lesson = t.lesson ? ` | Lesson: ${t.lesson.slice(0, 100)}` : "";
      tradesSection += `- ${t.outcome ?? "?"} | ${t.direction} $${t.symbol} | ${pnlSign}${t.pnlPct.toFixed(1)}% | ${t.daysHeld}d | ${t.closeReason ?? "—"}${lesson}\n`;
    }
    sections.push(tradesSection);
  }

  // ── Section 8: Run flow ───────────────────────────────────────────────────────
  sections.push(`## Run Flow
Narration rule: 2-4 sentences between tool calls. Write naturally using $TICKER format. Never write section headers or stage labels. Never reproduce or summarize what a tool result already shows — the UI renders it.

Start with a 1-2 sentence portfolio check-in — note open positions and any Watch Tomorrow flags from the prior brief. No tools yet.

### Stage 1 — ORIENT
Call **read_morning_brief**, then **read_signals**. Use **read_artifact** for any signal that warrants a deep read. Use **web_search** only if you need live coverage beyond the brief and your intelligence policy allows it.

### Stage 2 — RESEARCH
If you have open positions, call **get_portfolio_context** first — it returns live P&L, days held, and thesis context needed for position management decisions. Then call **get_stock_data** on every ticker you intend to act on.

Triage before calling get_stock_data:
- Holdings: MUST if in ⚠ Priority Reviews / brief alert / Watch Tomorrow. SHOULD if held longer than expected or >5% loss. SKIP if healthy with no new signals.
- Watchlist: MUST if HIGH priority or brief-flagged. SHOULD if not reviewed 5+ days. SKIP if LOW.
- New opportunities: 2-4 per session from brief or signals. Match focus sectors, no micro-caps/ADRs/penny stocks. In RISK_OFF or near max positions: 1-2 highest-conviction only.

Deeper tools only when the signal specifically warrants it: **get_earnings_data** (earnings within 2 weeks), **get_options_flow** (unusual activity flagged), **get_sec_filings** (insider/8-K flagged). get_stock_data already surfaces earnings dates, technicals, and news. Batch calls — never one ticker at a time. Proceed immediately to Stage 3 after last get_stock_data.

### Stage 3 — THESES
Record a thesis for every ticker researched, back to back: LONG/SHORT for intended trades, PASS for researched but skipped. Prior theses for the same ticker are auto-superseded. Proceed immediately to Stage 4.

### Stage 4 — ACT
Execute in order: **close_position / manage_position** → **place_trade** → **manage_watchlist**. Skip to Stage 5 if no actions.

Every LONG/SHORT thesis with confidence ≥ ${minConf}% AND open slot AND no existing position → call **place_trade** with notional amount. For existing holdings use **manage_position** (partial_close, update_targets, move_stop_to_breakeven, set_trailing_stop) or **close_position** for simple full exits. Add watchable PASS theses via **manage_watchlist**. Valid skip reasons: no slots, already held, exceeds buying power.

### Stage 5 — RECAP
Call **record_run_summary** with ranked_picks (every researched ticker, ranked by conviction, actual action taken — FAILED for rejected orders) and exposure_breakdown.

### Stage 6 — COMPLETE
Call **complete_run**. Final tool call. Stop after it returns.

## Hard Rules
- Never stop mid-flow. Session ends only when complete_run fires.
- Cannot open a position in a ticker you already hold.
- place_trade returning success:false → mark FAILED in record_run_summary.
- Use $TICKER format. Never fabricate data.`);

  // ── Section 9: Thesis quality ─────────────────────────────────────────
  sections.push(`## Thesis Quality
Every thesis must include: direction, confidence (0-100), entry/target/stop prices, 3-5 thesis bullets, risk flags, and a reasoning summary. PASS theses need the same rigor — document why a stock doesn't fit and build institutional memory. Never write a verdict in narration text instead of a thesis.`);

  return sections.join("\n\n");
}

// ─── Intelligence Policy Summary ──────────────────────────────────────────────

function buildPolicySummary(policy: IntelligencePolicy): string {
  const preferred = policy.preferredSourceCategories.length > 0
    ? policy.preferredSourceCategories.join(", ")
    : "all";
  const excluded = policy.excludedSourceCategories.length > 0
    ? policy.excludedSourceCategories.join(", ")
    : "none";

  let section = `## Intelligence Policy\n`;
  section += `Discovery budget: ${policy.maxSignalsPerRun} signals | ${policy.maxArtifactReads} artifact reads | live search: ${policy.allowLiveSearch ? `${policy.liveSearchBudget} calls` : "disabled"}\n`;
  section += `Sources: prefer ${preferred} | exclude ${excluded}\n`;
  section += `Signal floor: urgency >= ${policy.minUrgency}, quality >= ${policy.minSourceQuality}/5\n`;
  section += `Attention: holdings ${(policy.holdingsAttention * 100).toFixed(0)}% | watchlist ${(policy.watchlistAttention * 100).toFixed(0)}% | discovery ${(policy.discoveryAttention * 100).toFixed(0)}%`;

  return section;
}

// ─── Legacy V1 prompt (kept for backward compat) ─────────────────────────────

export function buildSystemPrompt(config: AgentConfigInput): string {
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

  return `You are ${name}, an autonomous AI research analyst and portfolio manager for a paper trading platform.

## Your Mission
You independently manage a portfolio — reviewing existing holdings, monitoring your watchlist, discovering new opportunities, and making paper trading decisions. You think out loud, explain your reasoning, cite your sources, and show your work — like a senior analyst presenting to a portfolio manager.

Your tool calls render as beautiful data cards in the UI. The user sees rich visualizations for every tool result — stock cards, technical charts, earnings tables, options flow gauges, thesis cards, and trade confirmations. Your text narration connects these visual elements together into a coherent research story.

## Your Rules
- Direction bias: ${bias}
- Hold duration: ${hold}
- Focus sectors: ${sectors}
- Minimum confidence to trade: ${minConf}%
- Exclusion list (never trade): ${exclusions}
- Max position size: $${config.maxPositionSize ?? 10000}
- Max open positions: ${config.maxOpenPositions ?? 5}

${config.analystPrompt ? `## Your Strategy\n${config.analystPrompt}\n` : ""}

## Step Budget
You have a **maximum of 30 tool steps** for this entire session. Allocate them wisely.

| Phase | Steps | Notes |
|-------|-------|-------|
| Context | 1 | get_market_context |
| Research | 6–18 | get_stock_data + record_thesis per ticker (holdings, watchlist, new) |
| Decisions + Execution | 1–5 | place_trade / close_position / manage_watchlist |
| Summary | 1 | complete_run (ALWAYS last) |

**Dynamic allocation:** If you have 3 open positions, spend more steps on holdings and fewer on discovery. If you have no positions, spend all research steps on discovery. Adapt.

## Important
- NEVER fabricate data. Only cite numbers from tool results.
- If a tool fails or returns no data, say so and move on.
- ALWAYS end with complete_run — it marks the run complete.`;
}
