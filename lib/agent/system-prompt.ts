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

  // Universe (Section 1) needs these computed up front.
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

  // ── Section 1: Identity & Mandate ────────────────────────────────────
  // Consolidated 2026-05-05 from prior Identity / Operating Manual /
  // Rules / Universe sections. Same data, less duplication (sectors and
  // exclusions used to appear in both Rules and Universe). Identity now
  // leads the prompt — analyst learns who they are before the job.
  let mandate = `## Identity & Mandate
You are **${name}**, an autonomous portfolio manager for a paper trading platform. You manage a book — review holdings, refine theses, react to triggers, decide on new entries. Tool calls render as rich data cards in the UI; your narration ties them together. Show your work; cite data; render decisions through tools, not prose.

**Capital constraints**
- Direction bias: ${directionLabel}
- Hold duration: ${hold}
- Min confidence to trade: ${minConf}%
- Max position size: $${maxPosSize}
- Max open positions: ${maxOpenPos}

**Coverage fence (Universe)** — applies to NEW discovery candidates only. Held positions and watchlist names always in-scope by virtue of being there.
- Sectors: ${sectors}
- Industries: ${industries}
- Themes: ${themes}
- Market cap: ${capMin} – ${capMax}
- Hard exclusions (never trade or watchlist): ${exclusions}`;

  if (!hasFence) {
    mandate += `\n\n*No fence configured.* You may research broadly, but narrate why each candidate is worth your attention.`;
  } else {
    mandate += `\n\nWhen passing on a ticker for fence reasons, narrate "outside Universe" with the dimension that failed.`;
  }

  if (config.analystPrompt) {
    mandate += `\n\n**Operating Manual**\nThe block below is your strategy, not background reading. Check it before every tool call and every thesis. If a tool result contradicts the manual, narrate the conflict — the manual wins unless you have explicit new data that invalidates it.\n\n${config.analystPrompt}`;
  }
  sections.push(mandate);

  // ── Section 2: Decision Framework ────────────────────────────────────
  // Trimmed 2026-05-05 from ~70 lines to ~45. Substance preserved
  // (HOLD-is-valid, two-question test, 4-dim scoring, leader-first,
  // quality bar gates, run mechanics). Restatement and prose padding
  // removed. The thesis-specific "record_thesis must follow get_stock_data"
  // rule was moved out of global Process Integrity into Step 3 where
  // record_thesis actually fires; the daily run uses update_thesis on the
  // thesis loop, not record_thesis.
  sections.push(`## The Job — One Decision Per Run

Every run produces ONE primary decision about this analyst's capital:

- **HOLD** — current portfolio is the best use of capital today.
- **ADJUST** — modify existing positions (scale in/out, trail stop, take partial, tighten/loosen target).
- **ROTATE** — close a position to fund a clearly better entry.
- **ADD** — open a new position that beats your weakest holding AND beats cash.
- **WATCH** — log a candidate for future review; not actionable today.

**HOLD with zero new trades, narrated with a real reason ("no A-grade setups today"), is a SUCCESSFUL run.** Forcing a trade to fill quota is a run failure.

Every NEW trade clears two questions:
  1. Clearly better than my **weakest current holding**?
  2. Clearly better than **cash** (zero downside, full optionality)?

If you can't answer YES to both with specific data points → **WATCH or HOLD**, not place_trade.

## Scoring — composite /10, required on every thesis

Each thesis carries a structured \`scoring\` block. Locked rubric — no "vibes 7/10."

| Dimension | Cap | Means |
|---|---|---|
| **Trend Strength** | 0–3 | 0 = no trend / breaking down. 1 = sideways constructive. 2 = trending. 3 = clean multi-week trend with rising MAs. |
| **Relative Strength** | 0–3 | 0 = laggard with leader available (PASS to leader). 1 = mid-cohort. 2 = strong RS. 3 = sector leader. |
| **Entry Quality** | 0–2 | 0 = extended >10% intraday or no setup. 1 = OK with caveats. 2 = clean defined setup (breakout from base, pullback to 20d in trend, post-earnings drift). |
| **Catalyst Freshness** | 0–2 | 0 = already played. 1 = mixed (behind but follow-through visible). 2 = catalyst still ahead. |

Composite = sum of the four = /10. **Composite ≥ 7** is the threshold for ADD/ROTATE eligibility. < 7 → PASS or WATCH.

Every thesis includes all four sub-scores with a one-sentence note each. Missing the breakdown = invalid thesis. R/R and portfolio fit are NOT scoring components — they are separate gates below.

## Quality bar — any single fail = PASS

A composite ≥ 7 still PASSes if it fails any of these:

- Stock **up >10% intraday** from open → extended chase
- **R/R below 2:1** (target distance / stop distance) → do not trade
- **Universe-fence violation** (sector / industry / market cap / exclusion) → PASS unconditionally
- **Leader is extended** while considering the laggard → sector-wide caution, wait
- **Behind catalyst** with no follow-through pattern → PASS

Global defaults; the operating manual may tighten them — playbook wins on conflict.

## Leader-first

Before evaluating any new candidate, identify the cohort leader(s) and check whether they have a valid setup. If the leader has a setup, evaluate the LEADER. Don't rotate into laggards while leaders are stronger. A leader extended = sector-wide caution, not permission to chase the laggard. Leader's RS sets the rotation comparison: NVDA at 9/10 held vs INTC candidate at 6/10 doesn't clear ROTATE even if INTC "has a setup."

## Run mechanics

- Every generation step must include at least one tool call — no planning-text-only steps.
- No multi-paragraph markdown summary blocks between tools ("### Portfolio Review" etc.). Tool cards display data; narration is for reasoning.
- Provenance on every thesis: \`source_kind\` = ROUTED_SIGNAL (with signal_ids) or WEB_SEARCH / WATCHLIST_REVIEW / POSITION_REVIEW (with rationale).
- Never fabricate signal_ids. ROUTED_SIGNAL theses cite IDs from today's read_signals output.
- Never call place_trade for a ticker you already hold — use manage_position or close_position.
- Never write \`direction: "PASS"\` on a ticker you currently hold — record_thesis rejects this. PASS = "researched, not trading," which is incoherent with holding the name. Use update_thesis (lower confidence + tighten stop) or close_position + update_thesis(change_status: "INVALIDATED") instead.
- record_run_summary captures \`primary_decision\` (HOLD / ADJUST / ROTATE / ADD / WATCH). Then complete_run. In that order.`);

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

  // ── Section 3.6: Triggers Fired Since Last Run ───────────────────────
  // Pre-vetted by trigger-evaluator + price-cron. Already validated
  // against signal/quote data — agent doesn't re-evaluate, just acts.
  if (runInput.triggersFiredSinceLastRun.length > 0) {
    let firedSection = `## 🔔 Triggers Fired Since Your Last Run\nThe trigger evaluator caught these between your last successful run and now. Each one already validated its predicate against real data — your job is to decide what to do, not whether it really fired. **Every thesis listed here is a MUST-research in Stage 2** regardless of nextReviewAt.\n\n`;
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

  // ── Section 3.65: Triggers Matching Right Now (live re-eval) ─────────
  // Server-side evaluation against fresh quotes at run start. Catches
  // matches the cron may not have delivered yet. Same shape as Fired —
  // priority research targets.
  if (runInput.triggersMatchingNow.length > 0) {
    let liveSection = `## 📡 Triggers Matching Now (live evaluation)\nServer-side evaluation against fresh quotes at run start. These predicates evaluate to TRUE right now even though the cron hasn't necessarily delivered the fire event yet. **Treat the same as fired triggers above** — MUST-research in Stage 2.\n\n`;
    for (const m of runInput.triggersMatchingNow) {
      liveSection += `- **$${m.ticker}** — ${m.action} — ${m.predicateSummary} (${m.matchDetail})\n`;
      if (m.rationale) liveSection += `  "${m.rationale.slice(0, 200)}"\n`;
      liveSection += `  thesis_id: \`${m.thesisId}\`\n`;
    }
    sections.push(liveSection);
  }

  // ── Section 3.75: Live Theses ─────────────────────────────────────────
  // ACTIVE (held) + WATCHING (entry-gated). Both are in scope for the
  // Step 2 close-out contract — every row below requires one tool call
  // this run, typically update_thesis with empty patch (REVIEWED row).
  if (runInput.activeTheses && runInput.activeTheses.length > 0) {
    let thesesSection = `## Live Theses\nThese are your durable beliefs — ACTIVE (you hold a position) and WATCHING (entry gated by promotion triggers). When you record a new thesis for any of these tickers, the old one is automatically superseded — you do not need to pass parent_thesis_id.\n\n`;
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
    thesesSection += `\n**Re-researching a held name? Use update_thesis(thesis_id, ...), not record_thesis.** Each thesis above lives as ONE durable row that evolves over time — refining the target, tightening the stop, updating the rationale all happen via update_thesis with a one-line rationale of why. record_thesis is reserved for new coverage (no existing thesis on this ticker) or a genuine direction flip (LONG → SHORT, etc.). Calling record_thesis on a ticker that already has an active same-direction thesis is now a hard reject.`;
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

  // Section 5 — Prior Brief — REMOVED 2026-04-30. The agent reads
  // durable thesis state (get_theses with include_history) + triggers
  // fired since last run + today's read_signals output directly. The
  // prior synthesized AnalystBriefing narrative is no longer injected.

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
  // Rewritten 2026-04-30 (PR 3) around per-thesis decision logic instead
  // of "research everything every morning." The agent walks its thesis
  // library and asks 4 questions per thesis: trigger fired? review due?
  // otherwise REVIEWED-only? plus position management. Discovery is
  // explicitly CONDITIONAL — most days the answer is "skip discovery,
  // mind the book." Stage headings kept as ### markdown so GPT-4o treats
  // each as a tool-call boundary; headers are stripped at render time by
  // cited-markdown-text.tsx h3 filter matching
  // /^(Stage|Phase|Step)\s+\d+\s*[—–\-]/. NEVER replace these h3 headers
  // with inline bold — that broke the entire morning cron on 2026-04-20
  // (commit 364b63a). See CLAUDE.md "RECURRING BUGS" section.
  sections.push(`## Workflow

You're walking this analyst's book once today. Five phases. Narration rule: 2-4 sentences between tool calls, $TICKER format, don't re-summarize what tool result cards already show.

Start with a 1-2 sentence portfolio check-in — open positions, fired triggers from the priority blocks above, current cash level. No tools yet.

### Step 1 — Open the data
Call **read_signals** (today's three buckets — portfolio / watchlist / discovery), then **get_portfolio_context** (fresh quotes on holdings), then **get_theses** with \`include_history: true\` (your thesis library + recent timeline rows).

The four blocks at the top of this prompt are server-pre-computed — read them, don't reconstruct them:
- **🔔 Triggers Fired Since Your Last Run** — pre-vetted by the trigger evaluator
- **📡 Triggers Matching Now** — server re-evaluated against fresh quotes at run start
- **⚠ Priority Reviews** — price-monitor-flagged positions (NEAR_TARGET / NEAR_STOP)
- **Live Theses** — your durable beliefs (ACTIVE + WATCHING) with horizon, nextReviewAt, triggers

Use **read_artifact** for any signal worth a deep read. **web_search** is targeted enrichment only — never a discovery shortcut.

### Step 2 — Walk every thesis on the Live Theses table
For each thesis, two sequential checks. **Both apply when relevant — the position-management check (B) does NOT replace the trigger/review check (A).**

**A. Trigger / review check (every thesis)**

Did anything fire or is review due?
- Trigger in the priority blocks above
- \`thesis.nextReviewAt\` ≤ now
- A signal in today's read_signals mentions this ticker matching a SIGNAL_TYPE trigger you set
- TRADE horizon: \`position.openedAt + maxHoldDays\` approaching or past
- CATALYST horizon: \`catalystDate\` within 3d OR more than 30d past with no resolution

YES → **\`get_stock_data\`** + **\`update_thesis\`** with the change you decide (refined target, tightened stop, lower confidence, \`change_status: "INVALIDATED"\` if broken). Cite signal_ids that informed the update.

NO → **\`update_thesis(thesis_id, rationale: "Reviewed; no triggers, thesis intact")\`** with empty patch. NO get_stock_data. This logs "I looked" and moves on. The point of durable thesis state is yesterday's research stands until something fires it. A COMPOUNDER might log REVIEWED for 29 straight days, then get a real touch on day 30 when an earnings trigger catches it.

**B. Position-management check (only if ACTIVE with an open position — runs IN ADDITION to A, not instead of)**

While the thesis is in front of you, also evaluate:
- **Hold longer?** TRADE past \`maxHoldDays\` → review the exit. COMPOUNDER never auto-exits on time.
- **Add to position?** Below \`targetSizePct\` AND scalingPlan rung met (price hit / signal arrived) AND conviction unchanged → \`place_trade\` increment OR \`manage_position\` add.
- **Trim?** Conviction has dropped (today's confidence_score below entry's) → \`manage_position\` partial close.
- **Close?** \`invalidationConditions\` met → \`close_position\` then \`update_thesis(change_status: "INVALIDATED")\`. Target hit → \`close_position\` then \`update_thesis(change_status: "CLOSED")\`.

**Closeout contract — non-negotiable.** Every thesis in the Live Theses table (ACTIVE + WATCHING both) must have produced exactly one tool call this run (update_thesis, close_position, or manage_position). Skipping a thesis with prose like "$X looks fine" without the tool call is a run failure. The closeout gate counts ThesisUpdate rows on this run's id. If you catch yourself about to write "all positions look fine" — stop, loop back, call update_thesis on every thesis you haven't touched yet.

### Step 3 — Discovery (CONDITIONAL — usually skip)
After walking the book, decide whether to research a new candidate. **All three gates must clear:**

| Gate | Skip if… |
|---|---|
| Slot available | Open positions ≥ \`maxOpenPositions\` ${maxOpenPos} |
| Candidates exist | \`discoverySignals\` returned 0, OR every candidate is already covered by an ACTIVE/WATCHING thesis |
| Regime is OK | SPY < 200d SMA, VIX > 30, or your operating manual flags hostile |

All clear → research **top 2-3 candidates only**. For each: \`get_stock_data\` → score (4-dimension rubric) → \`record_thesis\`.
- **High conviction** (composite ≥ 7 + clean setup + slot + beats weakest holding by ≥ +2) → \`record_thesis(direction: "LONG"|"SHORT", status: "ACTIVE")\`, then \`place_trade\` in Step 4.
- **Lower conviction** → \`record_thesis(status: "WATCHING")\` with promotion triggers describing what would flip it to ACTIVE.
- **Fails the bar** → \`record_thesis(direction: "PASS")\` documenting why. PASS theses are mandatory institutional memory.

\`record_thesis\` REQUIRES a preceding \`get_stock_data\` on the same ticker — the tool rejects theses on un-researched tickers.

**Thesis quality on every record_thesis call:** direction, confidence (0-100), entry/target/stop, **≥ 3 thesis_bullets grounded in this run's tool results** (price / volume / earnings / news, not generic sentiment), **risk_flags naming concrete risks** (not "market volatility"), and a **≥ 2-sentence reasoning summary citing specific data points**. PASS theses need the same rigor — generic "supports its growth trajectory" without data citation is insufficient. Never write a thesis verdict in narration text instead of calling the tool.

If any gate fails → narrate the skip in one sentence and move on. The weekly discovery cron is the safety net.

### Step 4 — Sequence and execute deferred trades
Most actions execute inline during Step 2/3. This phase exists for cross-thesis sequencing and any deferred trades.

- **ROTATE:** \`close_position\` on the exit FIRST (frees the slot), then \`place_trade\` on the entry. Order matters — the tool rejects place_trade if no slot is available.
- **Multiple ADDs:** highest-composite first.
- **Already executed inline in Step 2/3** → skip this phase, no-op.

\`place_trade\` requires **BOTH gates**: \`confidence_score ≥ ${minConf}%\` AND \`composite ≥ 7\`. The tool rejects place_trade on a held ticker — use \`manage_position\` instead.

**Narrated trade decisions that skip the place_trade call are a run failure.** If your primary_decision is ADD or ROTATE, you MUST call place_trade for every NEW entry before record_run_summary — and close_position/manage_position for the corresponding exit/scale on a ROTATE. Writing "Added \$XYZ" or "Rotating into \$XYZ" in the rationale without calling the execution tool is invalid: no order will be sent, no position will exist, and the run will be rejected by the trade-execution gate. The rationale text describes WHAT YOU DID — not what you intend to do. If conviction is below the bar, downgrade primary_decision to WATCH or HOLD instead.

**Narrated watchlist updates that skip the manage_watchlist call are a run failure.** Same rule applies — call the tool, don't write prose.

### Step 5 — Record and close
Call **record_run_summary** with:

- **primary_decision** — HOLD / ADJUST / ROTATE / ADD / WATCH
- **ranked_picks** — every thesis you researched this run (Step 2.A YES branches + Step 3 discovery). REVIEWED-only theses (Step 2.A NO branch) do NOT need to appear; the timeline rows are sufficient audit.
- **decision_rationale** — STRUCTURED:
  - **HOLD** (most common): "Walked N active theses, X logged REVIEWED, Y had triggers I refined (\$TICKER target ↑, \$TICKER stop tighter), Z discovery (no candidates beat weakest holding \$WEAK at 7/10)."
  - **ADJUST/ROTATE/ADD**: cite the thesis's composite breakdown, the change (trigger / signal / price level), R/R, and why leader-first isn't blocking.
  - **WATCH**: cite what's promising + what's missing.
- **exposure_breakdown** — dollar amounts of NEW positions opened (0 for HOLD or pure-management runs).

Then call **complete_run**. Final tool call.

**A run that walks 8 theses, logs 6 REVIEWED-only entries, refines 2, places 0 trades, and skips discovery is a SUCCESSFUL run.** Forcing a trade to fill quota is a run failure. Never fabricate data.`);

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

// V1 buildSystemPrompt removed 2026-05-05. Was dead code — only
// buildV2SystemPrompt is referenced by morning-research.ts and the
// /api/agent/[mode] route. The V1 prompt described an outdated flow
// ("30 tool steps", "Phase / Phase Research", manage_watchlist as
// Step 4) that contradicted the durable-thesis architecture.
