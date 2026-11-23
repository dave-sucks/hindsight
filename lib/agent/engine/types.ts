/**
 * The agent engine's shapes (docs/plans/AGENT_ENGINE.md). Client-safe: the
 * Agents page and the Context panel read them.
 *
 * An agent is three things: its instructions, its context and its tools.
 * - Instructions: one markdown file (./agents/<agent>.md), the same on every
 *   run; it imports the files it shares with other agents ("@rules.md",
 *   "@research-rules.md").
 * - Context: the facts it is given, each one named read (./parts.ts), from
 *   the bundle its run's subject brings (lib/agent/context/bundles.ts); the
 *   record says which it reads and where each is sent: with the
 *   instructions (the analyst, the playbooks, the stock's situations, where
 *   they were measured) or in the first message.
 * - Tools: the tools it may call.
 * The run's task is the message, written by whoever starts the run; the
 * record's context list says where it goes in the first message. Every first
 * message opens with one line the engine writes: the date and time in ET, and
 * the account.
 */

import type { SubjectKind } from "@/lib/agent/context/bundles";

/** An instruction file: one markdown file in ./agents/. */
export type InstructionFile = `${string}.md`;


/** A fact an agent is given (./parts.ts): placed in its instructions or its first message, where its record lists it. */
export type ContextId =
  | "the_analyst"
  | "playbooks"
  | "the_playbook"
  | "holding_triggers"
  | "situations"
  | "market_numbers"
  | "market_digest"
  | "portfolio"
  | "portfolio_digest"
  | "the_book"
  | "stock_table"
  | "the_cases"
  | "the_analysts"
  | "the_stock"
  | "stock_data"
  | "playbook_record"
  | "earnings_this_week"
  | "filings_this_week"
  | "refused_calls"
  | "last_output"
  | "manager_writeup"
  | "earnings_calendar";

export type AgentId = "portfolio_manager" | "writer" | "holding_refresh" | "trigger_run" | "post_trade_writeup" | "after_buy" | "morning_run" | "chat" | "market_reviewer" | "portfolio_digest" | "discovery";

/** One entry of an agent's first message, after the date line: a read, or "message", where the run's task goes. */
export type FirstMessagePart = ContextId | "message";

/** One entry of an agent's instructions: an instruction file, or a fact placed there. */
export type InstructionEntry = InstructionFile | ContextId;

/** What a run hands the engine about itself. */
export interface AgentInput {
  now: Date;
  environment: "PAPER" | "LIVE";
  /** The run's task, written by whoever starts it; printed where the record's context lists "message". None in a conversation: there it is your message. */
  message?: string | null;
  /** The stocks this run's book holds and watches, for a reply that may name only those (the Market Reviewer's notes). */
  stocks?: readonly string[];
}

/** The model provider's own tools a record can name. */
export type ProviderToolId = "web_search";

export interface AgentRecord {
  id: AgentId;
  name: string;
  /** What it decides, in a sentence. */
  does: string;
  /** When it runs, for an agent an event starts. A scheduled agent's time is its line in the schedule (whenItRuns, ./schedule.ts), never a second copy here; one an event also starts names only the event. */
  runsWhen?: string;
  /** Who writes its message: a person, another agent, the trigger check or the schedule. */
  messageFrom: string;
  /** What its run is about: the account, an analyst, a thesis, or the chat. Its context comes from that subject's bundle (lib/agent/context/bundles.ts), and it reads nothing outside it. */
  subject: SubjectKind;
  model: string;
  maxSteps: number;
  /** How long its model call may run before it is stopped, in milliseconds. The agent runner (./run.ts) runs only a record that names one. */
  timeoutMs?: number;
  /**
   * Its instructions, in order: its one instruction file (the files it
   * imports inside it), and the facts sent with it (the analyst at the top,
   * the stock's situations at the end, where they were measured).
   */
  instructions: readonly InstructionEntry[];
  /**
   * Its first message after the date line, in order: each read, and
   * "message", where the run's task goes (last, for every agent but the two
   * Writers). In a conversation (`conversation`) the reads ride on each
   * message you send instead, and there is no "message": the message is yours.
   */
  context: readonly FirstMessagePart[];
  /** A conversation (the chat): its first message is yours, and the date line and its context ride on each new one. */
  conversation?: true;
  /** The tools it may call, by name (lib/agent/tools). */
  tools: readonly string[];
  /** The model provider's own tools it is given, by id (its web search); the page names them (providerToolNames). */
  providerTools?: readonly ProviderToolId[];
  /** The most web searches one call makes (Anthropic's search; OpenAI's takes no cap). */
  searchesPerCall?: number;
  /** OpenAI's Chat Completions API instead of Responses. */
  api?: "chat" | "responses";
  /** The reply's budget, its thinking counted; a reply cut off there fails the run. */
  maxOutputTokens?: number;
  /** Its save: the tool that, once a call to it goes through, ends the run (the Writer's submit_thesis). */
  endsWith?: string;
  /** The tools it is given once its save went through, in a call that continues from its note (the Writer's edit_triggers, run-thesis-writer.ts). */
  afterSave?: readonly string[];
  /** A reply that is data: its name, and its JSON schema, made from the run's input only. */
  reply?: { name: string; schema: (input: AgentInput) => Record<string, unknown> };
  /** What it hands back. */
  output: string;
}

/** A record the agent runner (./run.ts) can run: one that names its time limit. */
export type RunnableRecord = AgentRecord & { timeoutMs: number };

/** Where a part of a request went: the instructions, the first message, or the newest message of a conversation. */
export type Where = "instructions" | "message" | "newest";

/**
 * What a part of a request is: the agent's instruction file (its imports
 * inside it), the date line, a fact (context, sent with the instructions or
 * in the first message), or the run's task (the message). "shared" is a
 * rules file a run saved before the rules were imported.
 */
export type PartKind = "own" | "shared" | "line" | "context" | "message";

/** One part of a built request, as the run keeps it (lib/agent/run-requests.ts). */
export interface SentPartManifest {
  /** An instruction file's name, "line", "message", or the fact's id. */
  id: string;
  title: string;
  kind: PartKind;
  where: Where;
  /** The file the text comes from. */
  source: string;
  chars: number;
  /** An instruction file's parts, in order: its own words and each file it imports, where each starts. */
  sections?: Array<{ label: string; chars: number }>;
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

export const isFile = (e: InstructionEntry): e is InstructionFile => e.endsWith(".md");

/** An agent's own instruction file: its one document. */
export const ownFile = (r: Pick<AgentRecord, "instructions">): InstructionFile | null => r.instructions.find(isFile) ?? null;

/** Every fact an agent is given, in its instructions and its first message, in order. */
export const readsOf = (r: Pick<AgentRecord, "instructions" | "context">): ContextId[] => [
  ...r.instructions.filter((e): e is ContextId => !isFile(e)),
  ...r.context.filter((c): c is ContextId => c !== "message"),
];

/** The provider's own tools a record is given, named for the page: whose web search, and its cap. */
export const providerToolNames = (r: Pick<AgentRecord, "model" | "providerTools" | "searchesPerCall">): string[] =>
  (r.providerTools ?? []).map(() => `${r.model.startsWith("claude") ? "Anthropic" : "OpenAI"}'s web search${r.searchesPerCall ? `, up to ${r.searchesPerCall} searches` : ""}`);
