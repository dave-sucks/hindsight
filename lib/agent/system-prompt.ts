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

  // ── Section 3.5: Active Theses ───────────────────────────────────────
  if (runInput.activeTheses && runInput.activeTheses.length > 0) {
    let thesesSection = `## Active Theses\nThese are your current ACTIVE theses. Use parent_thesis_id when updating them.\n\n`;
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
    thesesSection += `\nWhen reviewing a holding, pass the thesis ID as parent_thesis_id to record_thesis to maintain the chain.`;
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

  // ── Section 6: Performance Context ───────────────────────────────────
  if (runInput.performance) {
    const perf = runInput.performance;
    const winRateStr =
      perf.winRate != null ? `${(perf.winRate * 100).toFixed(0)}%` : "—";
    let perfSection = `## Performance Context\nWin Rate: ${winRateStr} | Trades: ${perf.totalTrades}`;
    if (perf.calibrationNote) {
      perfSection += ` | Calibration: ${perf.calibrationNote}`;
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

Start with a 1-2 sentence portfolio check-in — acknowledge positions, watchlist items, and any "Watch Tomorrow" triggers from your prior brief. No tools yet. Your portfolio, watchlist, prior brief, active theses, and performance stats are already injected above.

### Stage 1 — ORIENT
Call **read_morning_brief**, then **read_signals**. Use **read_artifact** for any signal that warrants a deep read. Use **get_market_context** only if no morning brief is available (the brief already contains market context). Use **web_search** only if you need live coverage the brief doesn't have and your intelligence policy allows it.

### Stage 2 — RESEARCH
Pull **get_stock_data** on every ticker you intend to act on. Apply triage before calling:

**Holdings** — MUST: flagged by brief alert / near target or stop (>80%) / "Watch Tomorrow". SHOULD: held longer than expected, >5% unrealized loss, HIGH/BREAKING signal. SKIP: healthy, no new signals.

**Watchlist** — MUST: flagged in brief / HIGH priority / "Watch Tomorrow". SHOULD: HIGH/BREAKING signals, not reviewed 5+ days. SKIP: LOW priority, recently reviewed, no signals.

**New opportunities** (mandatory every session): 2-4 from brief or signals. Filter: focus sectors, no micro-caps/ADRs/penny stocks, match current regime. In RISK_OFF or near max positions: cut to 1-2 highest-conviction.

Go deeper only when the signal specifically warrants it — not by default:
- **get_earnings_data** — earnings within 2 weeks, or the signal is earnings-driven
- **get_options_flow** — unusual options activity flagged in signals
- **get_sec_filings** — insider filing or material 8-K flagged

get_stock_data already surfaces key earnings dates, technicals, and news. Only call the deeper tools when the thesis requires it.

**Batch your tool calls.** When you have 2-4 tickers to research, call get_stock_data for all of them in one step. Never research one ticker at a time.

Your IMMEDIATE next action after the last get_stock_data is Stage 3 — start record_thesis calls. No summary, no pause.

### Stage 3 — THESES
Call **record_thesis** for every ticker you researched, back to back, in one turn:
- LONG / SHORT for tickers you'll act on
- PASS for tickers you researched but won't trade — documents the decision, builds institutional memory
- Pass parent_thesis_id when updating an existing holding's thesis

Your IMMEDIATE next step after your last record_thesis is Stage 4.

### Stage 4 — DECIDE (no tool)
Write a 3-6 sentence paragraph — no tool call. Review every thesis, weigh against your portfolio, state what you plan to do. Example:
> "FIVN and AKAM are the two strongest setups — opening both. AMZN lacks a near-term catalyst, passing. Exposure stays within sector limits after these entries."

Your IMMEDIATE next step is Stage 5.

### Stage 5 — ACT
Execute decisions from Stage 4 in order: **close_position** → **place_trade** → **manage_watchlist**. Skip directly to Stage 6 if no actions.

### Stage 6 — RECAP
Call **record_run_summary** with ranked_picks (every researched ticker, ranked by conviction, with the action that ACTUALLY happened — use FAILED for place_trade calls that returned success:false) and exposure_breakdown. No synthesis text.

Your IMMEDIATE next step is Stage 7.

### Stage 7 — COMPLETE
Call **complete_run** with no arguments. Absolute final tool call. Stop generating after it returns.

## Hard Rules
- Run all stages in one continuous session. Never stop mid-flow. Session ends only when complete_run fires.
- Cannot open a new position in a ticker you already hold. Check the portfolio table above.
- place_trade returning success:false → mark that ticker FAILED (not PASS) in record_run_summary.
- Use $TICKER format. 2-4 sentences of narration between tool calls. Never fabricate data.
- Never output stage labels in your messages — write naturally.`);

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
