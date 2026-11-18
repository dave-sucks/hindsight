/**
 * The agent engine's shapes (docs/plans/AGENT_ENGINE.md). Client-safe: the
 * Agents page and the Context panel read them.
 *
 * An agent is three things: its instructions, its context and its tools.
 * - Instructions: its own text, and the shared texts it uses (./parts.ts).
 * - Context: the reads put in its first message, each one text.
 * - Tools: the tools it may call.
 * The run's task is the message, written by whoever starts the run; the
 * engine prints it last in the first message. Every first message opens with
 * one line the engine writes: the date and time in ET, and the account.
 */

/** A text more than one agent's instructions use (./parts.ts). */
export type SharedId = "house_rules" | "how_you_write" | "the_analyst" | "playbooks" | "research_rules";

/** A read put in an agent's first message (./parts.ts). */
export type ContextId =
  | "market_numbers"
  | "market_digest"
  | "portfolio"
  | "portfolio_digest"
  | "the_book"
  | "the_analysts"
  | "the_stock"
  | "stock_data"
  | "playbook_record"
  | "earnings_this_week"
  | "filings_this_week"
  | "refused_calls"
  | "last_output";

export type AgentId = "portfolio_manager" | "writer" | "holding_refresh" | "trigger_run" | "post_trade_writeup" | "morning_run" | "chat" | "market_reviewer" | "portfolio_digest";

/** One entry of an agent's instructions: its own text, or a shared text by name. */
export type InstructionPart = SharedId | { own: string };

/** What a run hands the engine about itself. */
export interface AgentInput {
  now: Date;
  environment: "PAPER" | "LIVE";
  /** The run's task, written by whoever starts it; printed last in the first message. None in a conversation: there it is your message. */
  message?: string | null;
}

export interface AgentRecord {
  id: AgentId;
  name: string;
  /** What it decides, in a sentence. */
  does: string;
  /** When it runs. */
  runsWhen: string;
  /** Who writes its message: a person, another agent, the trigger check or the schedule. */
  messageFrom: string;
  model: string;
  maxSteps: number;
  /** How long its model call may run before it is stopped, in milliseconds. The agent runner (./run.ts) runs only a record that names one. */
  timeoutMs?: number;
  /**
   * Its instructions, in order: its own text, once, and the shared texts it
   * uses. When its context has the stock, the stock's situations end them.
   */
  instructions: readonly InstructionPart[];
  /**
   * The reads in its first message, in order, after the date line. In a
   * conversation (`conversation`), they ride on each message you send instead.
   */
  context: readonly ContextId[];
  /** A conversation (the chat): its first message is yours, and the date line and its context ride on each new one. */
  conversation?: true;
  /** The tools it may call, by name (lib/agent/tools). */
  tools: readonly string[];
  /** The model provider's own tools it is given (its web search), named for the page. */
  providerTools?: readonly string[];
  /** What it hands back. */
  output: string;
}

/** A record the agent runner (./run.ts) can run: one that names its time limit. */
export type RunnableRecord = AgentRecord & { timeoutMs: number };

/** Where a part of a request went: the instructions, the first message, or the newest message of a conversation. */
export type Where = "instructions" | "message" | "newest";

/**
 * What a part of a request is: the agent's own text, a shared text, the
 * stock's situations (instructions), the date line, a read (context), or the
 * run's task (the message).
 */
export type PartKind = "own" | "shared" | "situations" | "line" | "context" | "message";

/** One part of a built request, as the run keeps it (lib/agent/run-requests.ts). */
export interface SentPartManifest {
  /** "own", "line", "message", "situations", or the shared text's or read's id. */
  id: string;
  title: string;
  kind: PartKind;
  where: Where;
  /** The file the text comes from. */
  source: string;
  chars: number;
  /** What was sent before it ("" for the first part). */
  sep?: string;
}

export interface BuiltRequest {
  /** The record it was built from: the run keeps it with what it sent (RequestRecord.agent). */
  agent: AgentId;
  instructions: string;
  message: string;
  /** Every part, in order: its instructions first, then its first message. */
  parts: SentPartManifest[];
  tools: readonly string[];
}

/** What rides on a conversation's newest message: each text in order, and its parts named. */
export interface BuiltNewest {
  /** The record it was built from. */
  agent: AgentId;
  texts: string[];
  parts: SentPartManifest[];
}

export const isOwnPart = (p: InstructionPart): p is { own: string } => typeof p !== "string";

/** An agent's own text. */
export const ownText = (r: Pick<AgentRecord, "instructions">): string => r.instructions.find(isOwnPart)?.own ?? "";

/** The shared texts an agent's instructions use, in order. */
export const sharedOf = (r: Pick<AgentRecord, "instructions">): SharedId[] => r.instructions.filter((p): p is SharedId => !isOwnPart(p));
