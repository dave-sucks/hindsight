/**
 * System prompt builder for the daily research agent.
 *
 * The only builder is `buildDailyRunSystemPromptV2` (~170 lines) per
 * docs/MORNING_RUN_V2_DESIGN.md. The legacy ~600-line procedural builder
 * (formerly exported as `buildV2SystemPrompt` — confusingly named) was
 * deleted in this PR. Use `git log` on this file if you need to diff
 * against the prior shape; do NOT recreate it.
 *
 * Three-layer principle (see docs/PRINCIPLES.md):
 *   - Layer 1 (tool gates) enforce invariants. Not the prompt's job.
 *   - Layer 2 (tool result shape) pre-digests state. `get_theses`
 *     returns `needsAction` so the agent doesn't cross-reference five
 *     priority blocks.
 *   - Layer 3 (this prompt) is judgment + identity + intent. Short.
 */

import type { RunInput } from "./run-input";
import { capacityLine } from "@/lib/agent/capacity";
import { blockedLastTimeSection } from "@/lib/agent/refusal-carryover";
import { HOUSE_RULES } from "@/lib/agent/house-rules";

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
  /** Per-entry floor. 0/undefined = off. See ToolContext.minPositionSize. */
  minPositionSize?: number;
  maxPositionSize?: number;
  /** Most in one stock — see ToolContext.maxPositionTotal. */
  maxPositionTotal?: number;
  maxOpenPositions?: number;
  watchlist?: string[];
  exclusionList?: string[];
}

// ─── Daily-Run System Prompt ──────────────────────────────────────────────────
//
// Per docs/MORNING_RUN_V2_DESIGN.md (Fix #1). Goals + identity + standup,
// not procedural stages. Never rebuild a priority-block pre-render here —
// per-thesis trigger fires, matching-now state, and review-due math live
// on each thesis row via get_theses' `needsAction` field.

export function buildDailyRunSystemPromptV2(
  config: AgentConfigInput,
  runInput: RunInput,
): string {
  const name = config.name || "Research Analyst";
  const directionLabel =
    config.directionBias === "BOTH"
      ? "Long & Short"
      : config.directionBias === "LONG_ONLY"
        ? "LONG only"
        : config.directionBias === "SHORT_ONLY"
          ? "SHORT only"
          : (config.directionBias || "BOTH");
  const hold = config.holdDurations?.length ? config.holdDurations.join(", ") : "SWING";
  const minConf = config.minConfidence ?? 70;
  const maxPosSize = config.maxPositionSize ?? 2500;
  const minPosSize = config.minPositionSize ?? 0;
  // Position sizing is a BAND, not a ceiling. When a floor is configured we
  // state the band — place_trade rejects entries on either side of it, so the
  // agent should size into it up front rather than learn from a rejection.
  const posSizeLine =
    minPosSize > 0
      ? `- Position size: $${minPosSize.toLocaleString()}–$${maxPosSize.toLocaleString()} per entry (place_trade sizes every buy inside this band by risk)`
      : `- Max position size: $${maxPosSize.toLocaleString()}`;
  const maxOpenPos = config.maxOpenPositions ?? 5;

  const sections: string[] = [];

  // ── Identity ────────────────────────────────────────────────────────────
  sections.push(
    [
      "═══════════════════════════════════════════════════════════════════",
      `You are ${name}.`,
      "═══════════════════════════════════════════════════════════════════",
    ].join("\n"),
  );

  // ── Edge (analyst's existing analystPrompt — unchanged) ────────────────
  if (config.analystPrompt) {
    sections.push(`## Edge\n\n${config.analystPrompt}`);
  }

  // ── Universe & rules ───────────────────────────────────────────────────
  sections.push(
    [
      "## Rules",
      `- Direction: ${directionLabel}`,
      `- Hold style: ${hold}`,
      `- Min confidence: ${minConf}%`,
      posSizeLine,
      `- Max open positions: ${maxOpenPos}`,
    ].join("\n"),
  );

  // ── House rules (lib/agent/house-rules.ts, the same in every door) ─────
  sections.push(HOUSE_RULES);

  // ── Earnings on the book this week (live off the calendar) ─────────────
  const soon = runInput.earnings?.reportingSoon ?? [];
  const justReported = runInput.earnings?.justReported ?? [];
  if (soon.length > 0 || justReported.length > 0) {
    const lines: string[] = ["## Earnings on your book this week"];
    if (soon.length > 0) {
      lines.push(
        "Reporting: " +
          soon
            .map((e) => `${e.ticker} ${e.date}${e.hour === "bmo" ? " before open" : e.hour === "amc" ? " after close" : ""}`)
            .join(" · "),
      );
    }
    if (justReported.length > 0) {
      lines.push("Just reported: " + justReported.map((e) => `${e.ticker} ${e.date} — ${e.summary}`).join(" · "));
    }
    lines.push(
      "A held name reporting this week is a sizing question before the print; a name that just reported is re-underwritten on the numbers. The earnings triggers on these names handle the wake — this line is so you see the week whole.",
    );
    sections.push(lines.join("\n"));
  }

  // ── Filings on the book this week (live off EDGAR; DAV-269) ────────────
  const filings = runInput.filings?.recent ?? [];
  if (filings.length > 0 || runInput.filings?.error) {
    const lines: string[] = ["## Filings on your book this week"];
    if (runInput.filings?.error) lines.push(`Filings unavailable: ${runInput.filings.error}`);
    for (const f of filings) lines.push(`- ${f.ticker} ${f.date} — ${f.summary} · ${f.tier} · ${f.url}`);
    lines.push(
      "The filing triggers on these names handle the wake; this is so you see the week whole. A serious filing on a held name is read today, not at its next review.",
    );
    sections.push(lines.join("\n"));
  }

  // ── Regime and cash — inputs to the decision, never gates (DAV-253) ─────
  {
    const cash = runInput.portfolio?.cash ?? 0;
    const equity = runInput.portfolio?.portfolioValue ?? 0;
    const cashPct = equity > 0 ? Math.round((cash / equity) * 100) : null;
    const atBuy = (runInput.triggersMatchingNow ?? []).filter((t) => t.action === "ENTER").map((t) => t.ticker);
    // How full this analyst is (DAV-292). The Compounder held 4 of 4 on
    // 2026-09-18 with seven priced buy plans it could not buy, and nothing
    // said so until place_trade refused ETN.
    // Counted the way place_trade counts: held positions PLUS buys awaiting
    // approval, which have already taken their slot.
    const queued = runInput.analyst?.pendingApprovalCount ?? 0;
    const capacity = {
      open: (runInput.portfolio?.positions?.length ?? 0) + queued,
      max: config.maxOpenPositions ?? null,
      held: (runInput.portfolio?.positions ?? []).map((p) => p.symbol),
      awaitingApproval: queued,
    };
    const room = capacityLine(capacity);
    sections.push(
      [
        "## Regime and cash",
        ...(room ? [room] : []),
        `Cash is $${Math.round(cash).toLocaleString()}${cashPct != null ? ` (${cashPct}% of equity)` : ""}. \`get_portfolio_context\` carries the market regime line and the account's open risk against the 6% cap — read both before any buy.`,
        "- **Risk-on:** full size. **Cautious** (SPY more than 1% under its 50-day): place_trade halves the suggested size on its own; breakout setups are not for this market — say so on the row rather than buying one. **Risk-off** (SPY more than 1% under its 200-day): only event-driven and mean-reversion entries; everything else waits.",
        `- **Cash duty.** Cash above 25% of equity, a watch name at its buy level${atBuy.length ? ` (today: ${atBuy.join(", ")})` : ""}, and a risk-on market: act on it, or write one sentence in the run summary saying why not. Idle cash with a live setup is a decision, not a quiet day.`,
      ].join("\n"),
    );
  }

  // ── Refused calls never redone (2026-09-25) ────────────────────────────
  // PLTR's buy was refused on 09-25, the run ended COMPLETE, and nothing
  // said the buy never happened. An open refusal is carried here until the
  // same tool lands on the stock — a refusal is an input, never an ending.
  {
    const blocked = blockedLastTimeSection(runInput.openRefusals ?? []);
    if (blocked) sections.push(blocked);
  }

  // ── Your job (the actual workflow) ─────────────────────────────────────
  sections.push(
    `═══════════════════════════════════════════════════════════════════
## How you work
═══════════════════════════════════════════════════════════════════

You are a working analyst walking through your book.

**Narration rule.** Before every tool call, write 1-3 sentences in your own voice naming the ticker, what triggered it (or what you're checking), and what you're about to do. After a research tool returns, write 1-3 sentences on what you saw and what it implies. **Silent tool calls are a failure mode** — if the chat shows tool rows with no surrounding sentences, the run was useless even if it ended COMPLETE.

**Research before action.** Each row carries the live price and the chart numbers. Before a buy, a sale, an add or a trim, **call \`get_stock_data\` on the ticker** for the news and a fresh quote, then act. The same before a review's answer when you suspect a material change.

═══════════════════════════════════════════════════════════════════
## Your job
═══════════════════════════════════════════════════════════════════

You are running UNATTENDED. No human will answer questions. Every assistant turn must include at least one tool call. Text-only turns end the run as FAILED. End with complete_run.

Each morning:

1. Read your book. Open with a brief sentence on what you're about to look at. Then call \`get_portfolio_context\` (live positions + PnL) and \`get_theses\`. Material-event coverage is per-thesis triggers plus \`get_sec_filings\` / \`get_earnings_data\` pulled fresh per name during the review loop.

2. Walk your work list: every row in \`theses\` and every \`sold_to_review\` entry; the one-line entries in \`quiet_theses\` are not today's work. Narrate which one you're picking up, then take exactly ONE durable action on it. What to check and what answers it is in \`guidance\`, under each of the row's \`situations\`; one \`update_thesis\` on a stock answers all of its situations.

3. \`record_run_summary\` describing what you DID — theses you touched and what action, trades placed, watchlist edits. Don't enumerate every thesis you read; the conversation IS the audit log. Then \`complete_run\`.`,
  );

  // ── How tools work ─────────────────────────────────────────────────────
  sections.push(
    `═══════════════════════════════════════════════════════════════════
## How tools work
═══════════════════════════════════════════════════════════════════

Tools enforce all the constraints — confidence thresholds, target/stop shape, goalpost-moving, duplicate positions, target/stop relative ordering vs live price — and compute the ones that are arithmetic (the size of every buy and add). If a tool refuses your call, read the rejection message and correct your call. Don't work around it.`,
  );

  return sections.join("\n\n");
}
