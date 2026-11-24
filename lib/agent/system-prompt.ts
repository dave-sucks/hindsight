/**
 * The morning run's request: its record (lib/agent/engine/agents/morning-run.ts)
 * with its facts read for the analyst, built by the agent engine
 * (`morningRunRequest`; a replay's from its recorded inputs, `dailyRunRequest`).
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
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import { buildAgentRequest } from "@/lib/agent/engine/build";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";
import type { ContextRun } from "@/lib/agent/context";
import type { SubjectOf } from "@/lib/agent/context/bundles";
import { loadPieces } from "@/lib/agent/context/market-and-portfolio";
import { earningsWeekText } from "@/lib/agent/context/earnings-this-week";
import { filingsWeekText } from "@/lib/agent/context/filings-this-week";
import { MORNING_RUN, morningKickoff } from "@/lib/agent/engine/agents/morning-run";
import type { BuiltRequest } from "@/lib/agent/engine/types";

// ─── Daily-Run System Prompt ──────────────────────────────────────────────────
//
// Per docs/MORNING_RUN_V2_DESIGN.md (Fix #1). Goals + identity + standup,
// not procedural stages. Never rebuild a priority-block pre-render here —
// per-thesis trigger fires, matching-now state, and review-due math live
// on each thesis row via get_theses' `needsAction` field.

/** The watched stocks at their buy price this morning: the kickoff names them. */
const atBuyOf = (runInput: Pick<RunInput, "triggersMatchingNow">) => (runInput.triggersMatchingNow ?? []).filter((t) => t.action === "ENTER").map((t) => t.ticker);

/** The morning run's message: the kickoff, with the watched stocks at their buy price, and the cash when the snapshot couldn't be read. */
export function morningMessage(runInput: Pick<RunInput, "triggersMatchingNow" | "portfolio">, pieces: PortfolioPiece[] | null | undefined): string {
  const snapshotRead = !!pieces?.length && !pieces.some((p) => p.text.includes("couldn't be read"));
  return morningKickoff(atBuyOf(runInput), snapshotRead ? null : (runInput.portfolio?.cash ?? 0));
}

/**
 * The morning run's request: its record (lib/agent/engine/agents/morning-run.ts),
 * its facts read for the analyst by the engine (lib/agent/context/: the
 * analyst, the market and the portfolio, its book, the week's earnings and
 * filings, the calls refused last time), and the schedule's kickoff. The
 * cron and the Run button send the same request.
 */
export async function morningRunRequest(run: ContextRun<SubjectOf<"analyst">>, runInput: Pick<RunInput, "triggersMatchingNow" | "portfolio">): Promise<BuiltRequest> {
  const pieces = await loadPieces(run, { portfolioDigest: MORNING_RUN.context.includes("portfolio_digest") });
  return buildAgentRequest(MORNING_RUN, { now: run.now, environment: run.subject.environment, message: morningMessage(runInput, pieces) }, run);
}

/**
 * The morning run's request from what a replay or a test has in hand,
 * written as the loaders write it (lib/agent/context/): the analyst with
 * its room, the recorded Market and portfolio reads, its book (the
 * get_theses read a recorded run made first), and the week.
 */
export function dailyRunRequest(analyst: BriefAnalyst & { tradingEnvironment?: string | null }, runInput: RunInput, now: Date = new Date(), book: string | null = null): BuiltRequest {
  // How full this analyst is (DAV-292), counted the way place_trade counts: held positions plus buys awaiting approval.
  const queued = runInput.pendingApprovalCount ?? 0;
  const capacity = {
    open: (runInput.portfolio?.positions?.length ?? 0) + queued,
    max: analyst.maxOpenPositions ?? null,
    held: (runInput.portfolio?.positions ?? []).map((p) => p.symbol),
    awaitingApproval: queued,
  };
  return composeAgentRequest(MORNING_RUN, { now, environment: analyst.tradingEnvironment === "LIVE" ? "LIVE" : "PAPER", message: morningMessage(runInput, runInput.portfolioPieces) }, {
    pieces: runInput.portfolioPieces ?? null,
    context: {
      the_analyst: analystBrief(analyst, capacity),
      the_book: book,
      earnings_this_week: earningsWeekText(runInput.earnings),
      filings_this_week: filingsWeekText(runInput.filings),
    },
  });
}
