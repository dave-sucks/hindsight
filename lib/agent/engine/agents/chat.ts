/**
 * The chat's record (docs/plans/AGENT_ENGINE.md): your conversation with
 * the desk, at the portfolio level or pinned to one analyst
 * (app/api/agent/[mode]/route.ts, mode "principal"). `chatRequest` and
 * `chatNewest` (lib/agent/system-prompts/chat.ts) read its texts.
 *
 * Its instructions: chat.md, the same on every run (it says what both scopes
 * mean; it imports the rules); pinned to an analyst, the analyst is sent
 * after it. It is a conversation: its first message is yours, and the date
 * line and its context ride on each message you send: the market and the
 * portfolio, and pinned, the analyst's book; at the portfolio level, each
 * analyst's room.
 */
import { MODES } from "@/lib/agent/modes";
import type { AgentRecord } from "../types";

export const CHAT: AgentRecord = {
  id: "chat",
  name: "Chat",
  does: "Answers you: explains, researches, finds stocks, sends them to the Writer, edits triggers, writes notes and proposes trades (each waits for you).",
  runsWhen: "When you write to it, at the portfolio level or pinned to one analyst.",
  messageFrom: "You: the conversation. The date line and its context ride on each message you send.",
  subject: "chat",
  model: MODES["principal"].model,
  maxSteps: MODES["principal"].maxSteps,
  tools: MODES["principal"].toolAllowlist ?? [],
  // Pinned to an analyst, the analyst ends the instructions, after the fixed text.
  instructions: ["chat.md", "the_analyst"],
  // On each message you send: pinned, the analyst's book; at the portfolio level, each analyst's room.
  context: ["market_numbers", "market_digest", "portfolio", "portfolio_digest", "the_book", "the_analysts"],
  conversation: true,
  output: "Its reply to you, and whatever its tools did: a note, a trigger edit, a stock sent to the Writer, a trade proposal (each waits for you).",
};
