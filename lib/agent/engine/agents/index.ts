/**
 * Every agent, as the Agents page lists it (docs/plans/AGENT_ENGINE.md). An
 * agent on the engine is its record; one not moved yet says which code still
 * builds it, and nothing else, so the page never shows a part it doesn't get.
 */
import type { AgentId, AgentRecord } from "../types";
import { PORTFOLIO_MANAGER } from "./portfolio-manager";
import { PORTFOLIO_DIGEST } from "./portfolio-digest";
import { MARKET_REVIEWER } from "./market-reviewer";

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
  { onEngine: true, record: MARKET_REVIEWER },
  { onEngine: true, record: PORTFOLIO_DIGEST },
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
