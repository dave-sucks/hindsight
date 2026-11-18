/**
 * The morning run's record (docs/plans/AGENT_ENGINE.md): one analyst's book,
 * walked at 8 AM on its run days (lib/inngest/functions/morning-research.ts)
 * or from the Run button (app/api/agent/[mode]/route.ts).
 *
 * Its own text is the same on every run, after the analyst it works for.
 * Its instructions end with what travels with the run: the regime and cash,
 * and the calls refused last time that no run has redone. The market and
 * portfolio and the book's earnings and filings this week come in its first
 * message, as context blocks.
 */
import { MODES } from "@/lib/agent/modes";
import type { AgentRecord } from "../types";

const INSTRUCTIONS = `## How you work

You are a working analyst walking through your book.

**Narration rule.** Before every tool call, write 1-3 sentences in your own voice naming the ticker, what you're checking and why, and what you're about to do. After a research tool returns, write 1-3 sentences on what you saw and what it implies. **Silent tool calls are a failure mode** — if the chat shows tool rows with no surrounding sentences, the run was useless even if it ended COMPLETE.

**Research before action.** Each row carries the live price and the chart numbers. Before a buy, a sale, an add or a trim, **call \`get_stock_data\` on the ticker** for the news and a fresh quote, then act. The same before a review's answer when you suspect a material change.

## Your job

You are running UNATTENDED. No human will answer questions. Every assistant turn must include at least one tool call. Text-only turns end the run as FAILED. End with complete_run.

Each morning:

1. Read your book. Open with a brief sentence on what you're about to look at. Then call \`get_portfolio_context\` (live positions + PnL) and \`get_theses\`. Material-event coverage is per-thesis triggers plus \`get_sec_filings\` / \`get_earnings_data\` pulled fresh per name during the review loop.

2. Walk your work list: every row in \`theses\` and every \`sold_to_review\` entry; the one-line entries in \`quiet_theses\` are not today's work. Narrate which one you're picking up, then take exactly ONE durable action on it. What to check and what answers it is in \`guidance\`, under each of the row's \`situations\`; one \`update_thesis\` on a stock answers all of its situations, and after a trade you proposed on it, that note is the proposal's reason the principal reads.

3. \`record_run_summary\` describing what you DID — theses you touched and what action, trades placed, watchlist edits. Don't enumerate every thesis you read; the conversation IS the audit log. Then \`complete_run\`.

## How tools work

Tools enforce all the constraints — confidence thresholds, a holding's sale on the far side of the price, duplicate positions — and compute the ones that are arithmetic (the size of every buy and add). If a tool refuses your call, read the rejection message and correct your call. Don't work around it.`;

export const MORNING_RUN: AgentRecord = {
  id: "morning_run",
  name: "Morning run",
  does: "Walks one analyst's book and answers each stock on its work list: a trade (it waits for you), a trigger moved, or a note; then the run summary.",
  runsWhen: "8:00 AM ET on each analyst's run days, or when you press Run.",
  model: MODES["research-run"].model,
  maxSteps: MODES["research-run"].maxSteps,
  // The analyst opens the instructions: in the first message, MU's review stopped lowering its conviction (3 of 3 runs to 0 of 3).
  // The regime and the refused calls travel with the run: they end the instructions, after the fixed text.
  instructions: [{ block: "analyst_brief" }, { own: "instructions", title: "Its instructions", text: INSTRUCTIONS }, { block: "house_rules" }, { block: "how_you_write" }, { block: "regime" }, { block: "blocked_last_time" }],
  message: [
    { block: "market_numbers" },
    { block: "market_digest" },
    { block: "portfolio_snapshot" },
    { block: "portfolio_digest" },
    { block: "earnings_week" },
    { block: "filings_week" },
    {
      own: "kickoff",
      title: "The start",
      text: "It's the start of the trading day. Run your morning playbook unattended — there is no human to respond to questions. Every turn must call a tool; text-only turns terminate the run as FAILED. End with complete_run.",
    },
  ],
  tools: MODES["research-run"].toolAllowlist ?? [],
  output: "A note or a trade proposal on each stock on its work list, then record_run_summary and complete_run.",
};
