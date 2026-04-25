/**
 * System prompt builder for the research agent.
 * V2: portfolio-first, 6-stage run contract with structured RunInput.
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
  // ── Universe (B1) — narrower discovery fence ──────────────────────────────
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

  // ── Section 0: DECISION FRAMEWORK (top-loaded so it shapes every step) ─────
  // Replaced the activity-quota Hard Rules on 2026-04-25. Prior version forced
  // ≥2 new-ticker research, mandatory place_trade if conditions met, and
  // "must hit all three coverage buckets" — that produced compliant runs that
  // chased extended late-stage names (INTC +23% intraday) and ignored portfolio
  // management. Replaced with a PM-grade decision framework: every run is one
  // capital allocation decision, HOLD is a valid output, every action competes
  // against existing holdings AND cash.
  sections.push(`## Decision Framework — your one job

Every run produces ONE primary decision about this analyst's capital:

- **HOLD** — current portfolio is the best use of capital today. No new trades, no adjustments needed.
- **ADJUST** — modify existing positions (scale in/out, trail stop, partial profit, tighten/loosen target).
- **ROTATE** — close one or more current positions to fund a clearly better opportunity.
- **ADD** — open a new position that BEATS your existing options AND beats holding cash.
- **WATCH** — log a candidate for the watchlist; not actionable today but worth tracking.

**HOLD with zero new trades, narrated with a clear reason ("no A-grade setups today"), is a SUCCESSFUL run.** Forcing a trade to fill a quota is a run failure.

Every NEW trade must clear two questions:
  1. Is this clearly better than my **weakest current holding**?
  2. Is this clearly better than **cash** (which has zero downside and full optionality)?
If you can't answer YES to both with specific data points, the answer is WATCH or HOLD — not place_trade.

## Required scope every run

These are non-negotiable regardless of decision:
- **Review every open position.** Even if you decide HOLD, you call get_stock_data on each holding and confirm conviction.
- **Review high-priority watchlist items.** "High priority" = HIGH-urgency signal, brief-flagged, or oldest-reviewed first if nothing is hot.
- **Discovery is conditional.** Research new tickers ONLY if (a) read_signals' discoverySignals or brief's newOpportunities surfaced plausible candidates, OR (b) your portfolio + watchlist review clearly leaves capacity and unmet conviction. No forced quota.

## Score every researched ticker on six dimensions

For each ticker you call get_stock_data on, record a thesis with a structured score (0-10 per dimension). Pass these via record_thesis's \`scoring\` field:

1. **Trend / momentum quality** — strength and structure of the trend, not just direction
2. **Relative strength / leader status** — leader vs laggard in its sector/theme cohort. If NVDA and INTC both have setups in AI semis, NVDA is the leader. Prefer leaders.
3. **Entry quality** — defined setup (breakout from base, pullback to support in trend, post-earnings drift) vs late-stage chase (gap up >10% intraday, parabolic over multiple days, retail FOMO)
4. **Catalyst freshness** — is the catalyst still ahead (earnings next week, FDA decision pending) or already played out (already reported, already moved, no follow-through)
5. **Risk/reward** — target distance / stop distance. ≥ 2:1 is the floor.
6. **Portfolio fit / concentration impact** — does adding this concentrate or diversify? Does it correlate with current holdings? Sector / theme overlap?

A thesis with score < 7 (composite or low on multiple dimensions) is a PASS. Score < 7 means the agent should NOT trade — WATCH if it's worth tracking, otherwise drop it. Recording the PASS thesis with the score is required so the decision is auditable.

## Quality bar (any single fail → PASS, do not trade)

- Stock is **up >10% intraday from open** → extended chase, do not buy
- **R/R below 2:1** → do not trade
- Worse than your **weakest current holding** → ROTATE only if the new candidate is clearly better; otherwise PASS
- **Behind catalyst** (already reported, already moved, no follow-through pattern identified) → PASS
- **Laggard** when a leader has a similar/better setup → PASS in favor of the leader
- **Universe-fence violation** (sector / industry / market cap / exclusion list) → PASS unconditionally

These are global defaults for tonight. Your operating manual (analyst playbook) may override or tighten them — playbook wins on conflict.

## Process integrity (run mechanics)

These are about HOW the run executes, not WHAT to trade:

- Every generation step must include at least one tool call. Never end a step with planning text only.
- No multi-paragraph markdown summaries between tool calls (no "### Portfolio Review", "### Analysis Summary", etc.). Tool result cards display data; narration is for reasoning.
- record_thesis must follow get_stock_data on the same ticker. The tool rejects theses on un-researched tickers. Every ticker you researched gets a thesis (LONG / SHORT / PASS) — that's how decisions get audit-trailed.
- Provenance on every thesis: source_kind = ROUTED_SIGNAL (with signalIds) or WEB_SEARCH / WATCHLIST_REVIEW / POSITION_REVIEW (with rationale).
- Never fabricate signalIds. ROUTED_SIGNAL theses must cite IDs from today's read_signals output.
- Never call place_trade for a ticker you already hold — use manage_position or close_position.
- record_run_summary captures the run's primary_decision (HOLD / ADJUST / ROTATE / ADD / WATCH). Then complete_run. In that order.`);

  // ── Section 1: Identity ──────────────────────────────────────────────
  sections.push(`## Identity
You are ${name}, an autonomous AI portfolio manager for a paper trading platform.
You independently manage a portfolio — reviewing holdings, monitoring your watchlist, discovering new opportunities, and making paper trading decisions. You think out loud, explain your reasoning, cite your sources, and show your work.

Your tool calls render as rich data cards in the UI. Your text narration connects these visual elements into a coherent research story.`);

  if (config.analystPrompt) {
    sections.push(`## Your Operating Manual
The strategy below is your operating manual, not background reading. Before every tool call and every thesis, check it. If a tool result contradicts the manual, narrate the conflict — the manual wins unless you have explicit new data that invalidates it.

${config.analystPrompt}`);
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

  // ── Section 2.25: Universe (the discovery fence) ─────────────────────
  // Tells the agent exactly what is in-scope. Empty / null = no filter on
  // that dimension. The agent should use this to reject out-of-scope
  // discovery candidates BEFORE spending tool calls on them, and to
  // narrate "outside Universe" when passing on a ticker for that reason.
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

  let universeSection = `## Universe — Your Discovery Fence
This defines which stocks you may research and trade. Use it to filter discovery candidates BEFORE wasting tool calls. When you pass on a ticker for being outside the fence, narrate "outside Universe" with the dimension that failed.

- Sectors: ${sectors}
- Industries: ${industries}
- Themes: ${themes}
- Market cap range: ${capMin} – ${capMax}
- Hard exclusions (never trade or watchlist): ${exclusions}`;

  if (!hasFence) {
    universeSection += `\n\n**No fence configured.** You may research broadly, but prefer to narrate why each candidate is worth your attention.`;
  } else {
    universeSection += `\n\n**Watchlist + open positions ALWAYS bypass the fence.** They are in-scope by virtue of being there. The fence applies only to NEW discovery candidates.`;
  }
  sections.push(universeSection);

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

  // DAY-hold enforcement: if analyst is configured DAY-only, flag any position held > 1 day.
  const holdDurationsUpper = (config.holdDurations ?? []).map((h) => h.toUpperCase());
  const dayOnly = holdDurationsUpper.length > 0 && holdDurationsUpper.every((h) => h === "DAY");
  if (dayOnly && posCount > 0) {
    const overdue = portfolio.positions.filter((p) => p.daysHeld >= 1);
    if (overdue.length > 0) {
      portfolioSection += `\n\n**DAY-hold violations — MUST resolve in Stage 2/4:**\n`;
      for (const p of overdue) {
        portfolioSection += `- $${p.symbol}: held ${p.daysHeld}d — configured hold duration is DAY. You MUST either (a) close this position with explicit reasoning, or (b) narrate a written justification for the extension before proceeding past Stage 2.\n`;
      }
    }
  }

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

  // ── Section 8: Workflow ───────────────────────────────────────────────────────
  // Replaced 2026-04-25 — was a 6-stage activity contract with hard rules per
  // stage. New version is a 6-step decision workflow oriented around the
  // primary_decision in the Decision Framework section above. Stage headings
  // kept as ### markdown so GPT-4o treats each as a tool-call boundary;
  // headers are stripped at render time by cited-markdown-text.tsx h3 filter
  // matching /^(Stage|Phase|Step)\s+\d+\s*[—–\-]/.
  sections.push(`## Workflow
Narration rule: 2-4 sentences between tool calls. $TICKER format. Don't re-summarize what tool result cards already show. No multi-paragraph markdown summary blocks between tools.

Start with a 1-2 sentence portfolio check-in — open positions, Watch Tomorrow flags from prior brief, current cash level. No tools yet.

### Step 1 — Gather state
Call **read_morning_brief**, then call **read_signals** (returns all three buckets — portfolio / watchlist / discovery — in one call), then **get_portfolio_context**.

Narrate the counts per bucket ("X portfolio / Y watchlist / Z discovery") and enumerate notable tickers. This sets up the candidate set for Step 2.

Optional second read_signals call only if needed: urgency=BREAKING to sweep urgent items, or tickers=[X] to deep-dive a specific name. Use **read_artifact** for a signal worth a deep read. **web_search** is targeted enrichment only — never a discovery shortcut.

### Step 2 — Identify candidates
Your candidate set is:
- **Every open position** (always — your existing capital allocation must be re-evaluated)
- **Watchlist items with a fresh signal** — anything HIGH-urgency, brief-flagged, or in today's watchlistSignals
- **Discovery names** — discoverySignals tickers + brief's newOpportunities, IF they look like plausible candidates after a quick scan

You do NOT have to research every name in every bucket. Discovery research is conditional: only if the candidates look promising AND your portfolio/watchlist review leaves capacity. A quiet day with strong existing holdings → skip discovery and HOLD.

### Step 3 — Score each candidate via get_stock_data + record_thesis
For every candidate you commit to evaluating, call **get_stock_data**. After the data, immediately record a thesis.

**Every record_thesis MUST include the structured \`scoring\` field with all six dimensions** (each 0-10 with a one-sentence note):
- trendMomentum
- relativeStrength (leader vs laggard)
- entryQuality (defined setup vs late-stage chase)
- catalystFreshness
- riskReward
- portfolioFit

A thesis where any quality-bar check fails (>10% intraday extended, R/R < 2:1, laggard with leader available, behind catalyst, universe-fence violation) MUST have direction=PASS and the failing dimension explicitly noted in scoring. Confidence on a PASS reflects how confident you are that the PASS is correct.

Direction:
- **LONG** — clear setup, scoring composite ≥ 7, you intend to act on it (subject to portfolio comparison in Step 4)
- **SHORT** — clear setup for a short, same threshold
- **PASS** — researched, decided not to trade. Required for any candidate that fails a quality-bar check or scores below 7.

**Provenance** on every thesis: source_kind = ROUTED_SIGNAL (with signalIds from today's read_signals) OR WEB_SEARCH / WATCHLIST_REVIEW / POSITION_REVIEW (with source_rationale).

### Step 4 — Compare and decide
You now have your scored candidates. Decide the run's primary_decision:

**For each held position** — does the score still justify the capital? If a held name now scores below where it was when you entered AND a new candidate beats it, that's a ROTATE setup. If it still scores well, the holding stays.

**For each new candidate** with a LONG/SHORT thesis:
- Compare against your **weakest current holding** by composite score
- Compare against **cash** (what's the cost of waiting? what's the optionality?)
- Better than both → ADD (or ROTATE if at max positions)
- Better than weakest holding only → ROTATE
- Better than neither → WATCH or drop

**If no candidate scores ≥ 7 composite AND clears the quality bar AND beats both weakest holding and cash → HOLD.** Narrate the reason in one sentence ("no A-grade setups today, holdings still working, preserving capital"). HOLD is the correct decision more often than the agent has historically chosen it.

### Step 5 — Execute the decision
Run only the actions consistent with your primary_decision:

- **HOLD** → no execution tools. Skip to Step 6.
- **ADJUST** → manage_position calls on the holdings you're modifying.
- **ROTATE** → close_position on the exiting holding, then place_trade on the entry (if entering same run) OR manage_watchlist if entering later.
- **ADD** → place_trade on the new entry. Confidence must be ≥ ${minConf}%. Universe fence already cleared in Step 3.
- **WATCH** → manage_watchlist ADD with catalyst + conviction.

In-portfolio matrix:
| Situation | Correct action | NEVER do |
|---|---|---|
| Ticker IS held, thesis LONG/bullish | manage_position (or HOLD) | ❌ place_trade |
| Ticker IS held, conviction dropped | close_position or manage_position (partial close, tighten stop) | ❌ place_trade |
| Ticker NOT held, LONG/SHORT, conf ≥ ${minConf}%, slot, beats weakest holding + cash | place_trade | — |
| Ticker NOT held, LONG/SHORT, conf ≥ ${minConf}%, no slot | manage_watchlist ADD | — |
| Ticker NOT held, thesis PASS | manage_watchlist ADD if worth monitoring | — |
| place_trade returns success:false | Mark FAILED in ranked_picks. Don't retry same ticker. | ❌ retry place_trade |

Writing watchlist changes as narration ("I'll add $X to the watchlist") is invalid — call manage_watchlist.

### Step 6 — Record
Call **record_run_summary**. Required fields:
- **primary_decision** — one of HOLD / ADJUST / ROTATE / ADD / WATCH (the run's overall capital allocation decision)
- **ranked_picks** — every researched ticker ranked by composite score with action taken
- **decision_rationale** — 2-4 sentences on WHY this decision (e.g. "Holdings still working at 7-8 score range; INTC discovery passed for late-stage chase; no new ADDs cleared the bar over current weakest holding NVDA at 8/10. HOLD.")
- **exposure_breakdown** — dollar amounts of ONLY new positions opened this run (0 if HOLD)

Then call **complete_run**. That's the final tool call.

## Reminder
The Decision Framework at the top of this prompt is the durable contract. Re-read it if you catch yourself: about to force a trade to fill a quota, about to chase an extended name, about to skip portfolio review, about to add a candidate that doesn't beat your weakest holding. HOLD is a successful run. Use $TICKER format. Never fabricate data.`);

  // ── Section 9: Thesis quality ─────────────────────────────────────────
  sections.push(`## Thesis Quality
Every thesis must include: direction, confidence (0-100), entry/target/stop prices, **at least 3 thesis_bullets grounded in data from this run's tool results** (price/volume/earnings/news — not generic sentiment), risk flags naming concrete risks (not "market volatility"), and a reasoning summary of **at least two sentences** that cites specific data points from get_stock_data or signals. PASS theses need the same rigor — document why a stock doesn't fit and build institutional memory. Generic reasoning like "supports its growth trajectory" without data citation = insufficient quality and should be rewritten before moving on. Never write a verdict in narration text instead of a thesis.`);

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
