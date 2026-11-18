/**
 * The agent engine's shapes (docs/plans/AGENT_ENGINE.md). Client-safe: the
 * Agents page and the Context panel read them.
 *
 * An agent is a record: its own instructions, the context blocks it is given
 * and where, its tools, its model and its step limit. The engine builds the
 * model request from the record and says which part of the request is which.
 */

/** A context block in the library (./blocks.ts). */
export type BlockId =
  | "house_rules"
  | "how_you_write"
  | "market_numbers"
  | "market_digest"
  | "portfolio_snapshot"
  | "watching"
  | "portfolio_digest"
  | "last_writeup"
  | "held_beliefs"
  | "watched_beliefs"
  | "reviewer_notes"
  | "last_digest"
  | "analyst_brief"
  | "playbooks"
  | "why_sent"
  | "sender_notes"
  | "idea_source"
  | "existing_thesis"
  | "promotion"
  | "setup_record"
  | "prior_exit"
  | "stock_data"
  | "chat_found"
  | "stock_row"
  | "fired_trigger"
  | "situations"
  | "fire_facts"
  | "earnings_week"
  | "filings_week"
  | "regime"
  | "blocked_last_time"
  | "money_context"
  | "book_context"
  | "analyst_rooms"
  | "today"
  | "date_awareness"
  | "research_note"
  | "thesis_claim"
  | "earnings_triggers"
  | "what_the_owner_reads";

export type AgentId = "portfolio_manager" | "writer" | "holding_refresh" | "trigger_run" | "post_trade_writeup" | "morning_run" | "chat" | "market_reviewer" | "portfolio_digest";

/** Part of the agent's own instructions: its job, in its own words. */
export interface OwnPart {
  own: string;
  title: string;
  /** The text, or the text for this run (a date, the account); null leaves the part out this run. */
  text: string | ((input: AgentInput) => string | null);
  /** What goes before it: a blank line unless the record says otherwise. */
  sep?: Sep;
}

/** The separator before a part, or the one for this run (when it follows a part only some runs print). */
export type Sep = string | ((input: AgentInput) => string);

/**
 * A block from the library, given to the agent. A block of the Market and
 * portfolio group prints inside that block, under the group's heading;
 * `alone` prints it on its own instead. A block on its own prints under
 * `heading` when the record gives one, else as its text alone.
 */
export interface BlockPart {
  block: BlockId;
  alone?: true;
  heading?: string;
  /** What goes before it: a blank line unless the record says otherwise. */
  sep?: Sep;
}

export type RecordPart = OwnPart | BlockPart;

/** What a run hands the engine about itself. */
export interface AgentInput {
  now: Date;
  environment: "PAPER" | "LIVE";
  /** What else one agent's own words need this run (the Writer's stock and mode), read by its record. */
  extra?: unknown;
}

export interface AgentRecord {
  id: AgentId;
  name: string;
  /** What it decides, in a sentence. */
  does: string;
  /** When it runs. */
  runsWhen: string;
  model: string;
  maxSteps: number;
  /** How long its model call may run before it is stopped, in milliseconds. The agent runner (./run.ts) runs only a record that names one. */
  timeoutMs?: number;
  /** The instructions, in order. */
  instructions: readonly RecordPart[];
  /** The first message, in order. */
  message: readonly RecordPart[];
  /**
   * In a conversation (the chat): what rides on each new message you send,
   * before your words. Each part is its own text on the message, the Market
   * and portfolio block one text, so none takes a separator.
   */
  newest?: readonly RecordPart[];
  /** The tools it may call, by name (lib/agent/tools). */
  tools: readonly string[];
  /** The model provider's own tools it is given (its web search), named for the page. */
  providerTools?: readonly string[];
  /** What it hands back. */
  output: string;
  /** For the Agents page: the run its own words are shown for, when they change with the run. */
  example?: { extra: unknown; says: string };
}

/** A record the agent runner (./run.ts) can run: one that names its time limit. */
export type RunnableRecord = AgentRecord & { timeoutMs: number };

/** Where a part of a request went: the instructions, the first message, or the newest message of a conversation. */
export type Where = "instructions" | "message" | "newest";

/** One part of a built request, as the run keeps it (lib/agent/run-requests.ts). */
export interface SentPartManifest {
  /** The own part's key, or the block's id. */
  id: string;
  title: string;
  kind: "own" | "block";
  where: Where;
  /** The file the text comes from. */
  source: string;
  chars: number;
  /** What was sent before it ("" for the first part); a record kept before this was a blank line. */
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

export const isOwn = (p: RecordPart): p is OwnPart => "own" in p;
