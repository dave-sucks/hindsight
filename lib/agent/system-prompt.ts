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
import { analystBrief, type BriefAnalyst } from "@/lib/agent/analyst-brief";
import { blockedLastTimeSection } from "@/lib/agent/refusal-carryover";
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import { MORNING_RUN, type MorningRunExtra } from "@/lib/agent/engine/agents/morning-run";
import type { BuiltRequest } from "@/lib/agent/engine/types";

// ─── Daily-Run System Prompt ──────────────────────────────────────────────────
//
// Per docs/MORNING_RUN_V2_DESIGN.md (Fix #1). Goals + identity + standup,
// not procedural stages. Never rebuild a priority-block pre-render here —
// per-thesis trigger fires, matching-now state, and review-due math live
// on each thesis row via get_theses' `needsAction` field.

/** The book's earnings this week (live off the calendar): the earnings_week block, or null when there are none. */
function earningsWeekText(runInput: RunInput): string | null {
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
    return lines.join("\n");
  }
  return null;
}

/** The book's filings this week (live off EDGAR; DAV-269): the filings_week block, or null when there are none. */
function filingsWeekText(runInput: RunInput): string | null {
  const filings = runInput.filings?.recent ?? [];
  if (filings.length > 0 || runInput.filings?.error) {
    const lines: string[] = ["## Filings on your book this week"];
    if (runInput.filings?.error) lines.push(`Filings unavailable: ${runInput.filings.error}`);
    for (const f of filings) lines.push(`- ${f.ticker} ${f.date} — ${f.summary} · ${f.tier} · ${f.url}`);
    lines.push(
      "The filing triggers on these names handle the wake; this is so you see the week whole. A serious filing on a held name is read today, not at its next review.",
    );
    return lines.join("\n");
  }
  return null;
}

/**
 * The morning run's request, built by the agent engine from its record
 * (lib/agent/engine/agents/morning-run.ts): its instructions, and its
 * first message (the start of the day) for a run the cron starts.
 */
export function dailyRunRequest(analyst: BriefAnalyst, runInput: RunInput): BuiltRequest {
  // How full this analyst is (DAV-292). The Compounder held 4 of 4 on
  // 2026-09-18 with seven priced buy plans it could not buy, and nothing
  // said so until place_trade refused ETN.
  // Counted the way place_trade counts: held positions PLUS buys awaiting
  // approval, which have already taken their slot.
  const queued = runInput.pendingApprovalCount ?? 0;
  const capacity = {
    open: (runInput.portfolio?.positions?.length ?? 0) + queued,
    max: analyst.maxOpenPositions ?? null,
    held: (runInput.portfolio?.positions ?? []).map((p) => p.symbol),
    awaitingApproval: queued,
  };


  // Regime and cash — inputs to the decision, never gates (DAV-253).
  // The cash itself is in the Market and portfolio block's snapshot, so it isn't said twice, unless the snapshot couldn't be read.
  const pieces = runInput.portfolioPieces ?? null;
  const snapshotRead = !!pieces?.length && !pieces.some((p) => p.text.includes("couldn't be read"));
  const extra: MorningRunExtra = {
    snapshotRead,
    cash: runInput.portfolio?.cash ?? 0,
    atBuy: (runInput.triggersMatchingNow ?? []).filter((t) => t.action === "ENTER").map((t) => t.ticker),
  };
  return composeAgentRequest(MORNING_RUN, { now: new Date(), environment: "PAPER", extra }, {
    pieces,
    blocks: {
      // The analyst (lib/agent/analyst-brief.ts, the same in every door).
      analyst_brief: analystBrief(analyst, capacity),
      earnings_week: earningsWeekText(runInput),
      filings_week: filingsWeekText(runInput),
      // Refused calls never redone (2026-09-25): PLTR's buy was refused on
      // 09-25, the run ended COMPLETE, and nothing said the buy never
      // happened. An open refusal is carried here until the same tool lands
      // on the stock — a refusal is an input, never an ending.
      blocked_last_time: blockedLastTimeSection(runInput.openRefusals ?? []) || null,
    },
  });
}

/** The morning run's instructions alone (dailyRunRequest). */
export function buildDailyRunSystemPromptV2(analyst: BriefAnalyst, runInput: RunInput): string {
  return dailyRunRequest(analyst, runInput).instructions;
}
