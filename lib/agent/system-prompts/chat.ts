/**
 * The chat's request, from its record (lib/agent/engine/agents/chat.ts), from
 * what a replay or a test has in hand: its instructions, at the portfolio
 * level or pinned to one analyst, and what rides on your newest message. A
 * live chat's facts are read for its scope (lib/agent/context/,
 * app/api/agent/[mode]/route.ts). Its first message is your conversation.
 */
import type { AnalystCapacity } from "@/lib/agent/capacity";
import { analystBrief, type BriefAnalyst, type UniverseAnalyst } from "@/lib/agent/analyst-brief";
import { CHAT } from "@/lib/agent/engine/agents/chat";
import { composeAgentRequest, composeNewest } from "@/lib/agent/engine/engine";
import type { BuiltNewest, BuiltRequest } from "@/lib/agent/engine/types";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";

type ScopedAnalyst = BriefAnalyst & UniverseAnalyst & { id: string; name: string };

export interface ChatPromptOpts {
  /** The analyst the chat is pinned to: its row and the account's setup numbers. */
  scopedAnalyst?: ScopedAnalyst | null;
  /** Its slots, counted as place_trade counts them (pinned). */
  room?: AnalystCapacity | null;
}

/**
 * The pinned analyst, as the chat reads it: the analyst's text, its first
 * line the analyst the chat is pinned to and its id (a fact of the pinned
 * chat; the chat's tools act on it).
 */
export function pinnedAnalystText(scope: ScopedAnalyst, room?: AnalystCapacity | null): string {
  return `## Current scope — pinned to ${scope.name} (Analyst ID: \`${scope.id}\`)\n\n${analystBrief(scope, room)}`;
}

/** The chat's instructions, each part named for the run's Context panel. */
export function chatRequest(opts: ChatPromptOpts, environment: "PAPER" | "LIVE" = "PAPER"): BuiltRequest {
  const scope = opts.scopedAnalyst;
  return composeAgentRequest(CHAT, { now: new Date(), environment }, { context: { the_analyst: scope ? pinnedAnalystText(scope, opts.room) : null } });
}

/**
 * What rides on your newest message: the date line, the Market and portfolio
 * reads, and pinned the analyst's book or at the portfolio level each
 * analyst's room, each part named for the chat's Context.
 */
export function chatNewest(
  now: Date,
  pieces: PortfolioPiece[] | null,
  environment: "PAPER" | "LIVE" = "PAPER",
  reads: { book?: string | null; analysts?: string | null } = {},
): BuiltNewest {
  return composeNewest(CHAT, { now, environment }, { pieces, context: { the_book: reads.book ?? null, the_analysts: reads.analysts ?? null } });
}

/** The chat's instructions as one string. */
export function buildPrincipalSystemPrompt(opts: ChatPromptOpts): string {
  return chatRequest(opts).instructions;
}
