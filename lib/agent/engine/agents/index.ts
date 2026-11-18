/**
 * Every agent, as the Agents page lists it (docs/plans/AGENT_ENGINE.md). An
 * agent on the engine is its record; one not moved yet says which code still
 * builds it, and nothing else, so the page never shows a part it doesn't get.
 */
import type { AgentId, AgentRecord } from "../types";
import { PORTFOLIO_MANAGER } from "./portfolio-manager";

export interface PendingAgent {
  id: AgentId;
  name: string;
  does: string;
  runsWhen: string;
  /** The code that still builds its request. */
  builtBy: string;
}

export type AgentEntry = { onEngine: true; record: AgentRecord } | { onEngine: false; agent: PendingAgent };

/** In the order they move onto the engine. */
export const AGENTS: readonly AgentEntry[] = [
  { onEngine: true, record: PORTFOLIO_MANAGER },
  {
    onEngine: false,
    agent: { id: "portfolio_digest", name: "Portfolio digest", does: "Writes your evening summary of the account.", runsWhen: "8:00 PM ET on market days.", builtBy: "lib/agent/digest-writer.ts" },
  },
  {
    onEngine: false,
    agent: { id: "market_reviewer", name: "Market Reviewer", does: "Writes the morning market digest, and notes on our stocks its research touches.", runsWhen: "7:30 AM ET on market days.", builtBy: "lib/agent/market-reviewer/" },
  },
  {
    onEngine: false,
    agent: { id: "writer", name: "Writer", does: "Researches one stock and writes its thesis and its triggers.", runsWhen: "When a stock is sent to it: from the chat, a run or the Portfolio Manager.", builtBy: "lib/agent/run-thesis-writer.ts" },
  },
  {
    onEngine: false,
    agent: { id: "trigger_run", name: "Trigger run", does: "Decides on one stock when one of its triggers fires.", runsWhen: "Every 5 minutes in market hours and at the 4:20 PM close check, when a trigger fires.", builtBy: "lib/agent/system-prompts/intraday-tactical.ts and lib/inngest/functions/tactical-run.ts" },
  },
  {
    onEngine: false,
    agent: { id: "morning_run", name: "Morning run", does: "Walks one analyst's book and answers each stock on its work list.", runsWhen: "8:00 AM ET on each analyst's run days.", builtBy: "lib/agent/system-prompt.ts and lib/agent/run-input.ts" },
  },
  {
    onEngine: false,
    agent: { id: "chat", name: "Chat", does: "Answers you: explains, researches, edits triggers, writes notes and proposes trades.", runsWhen: "When you write to it.", builtBy: "lib/agent/modes.ts (buildPrincipalSystemPrompt)" },
  },
];
