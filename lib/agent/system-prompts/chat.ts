/**
 * The chat's request, from its record (lib/agent/engine/agents/chat.ts): its
 * instructions, at the portfolio level or pinned to one analyst, and what
 * rides on your newest message. Its first message is your conversation.
 */
import type { AnalystCapacity } from "@/lib/agent/capacity";
import { analystBrief, universeLines, type BriefAnalyst, type UniverseAnalyst } from "@/lib/agent/analyst-brief";
import { CHAT, type ChatExtra } from "@/lib/agent/engine/agents/chat";
import { composeAgentRequest, composeNewest } from "@/lib/agent/engine/engine";
import type { BuiltNewest, BuiltRequest } from "@/lib/agent/engine/types";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";

export interface ChatPromptOpts {
  /**
   * Pinned to an analyst, the seat's money and book travel with the scope,
   * rendered by formatMoneyContextBlock / formatBookContextBlock
   * (lib/agent/context-bundle.ts) so every surface quotes the same numbers.
   * Null prints nothing.
   */
  moneyBlock?: string | null;
  bookBlock?: string | null;
  /** The analyst the chat is pinned to: its row, its watchlist, and the account's setup numbers. */
  scopedAnalyst?: (BriefAnalyst & UniverseAnalyst & { id: string; name: string; watchlist: string[] }) | null;
  /** Its slots, counted as place_trade counts them (pinned); every analyst's room line (unpinned). */
  room?: AnalystCapacity | null;
  roomLines?: string[];
}

const UNPINNED: ChatExtra = { pinned: false, name: "", id: "", universe: [], watchlist: [] };

/** The chat's request: its instructions, each part named for the run's Context panel. */
export function chatRequest(opts: ChatPromptOpts, environment: "PAPER" | "LIVE" = "PAPER"): BuiltRequest {
  const scope = opts.scopedAnalyst;
  const extra: ChatExtra = scope ? { pinned: true, name: scope.name, id: scope.id, universe: universeLines(scope), watchlist: scope.watchlist } : UNPINNED;
  return composeAgentRequest(
    CHAT,
    { now: new Date(), environment, extra },
    {
      blocks: {
        analyst_brief: scope ? analystBrief(scope, opts.room) : null,
        money_context: scope && opts.moneyBlock ? opts.moneyBlock : null,
        book_context: scope && opts.bookBlock ? opts.bookBlock : null,
        analyst_rooms: !scope && opts.roomLines?.length ? opts.roomLines.map((l) => `  • ${l}`).join("\n") : null,
      },
    },
  );
}

/** What rides on your newest message: the time and the Market and portfolio block, each part named for the chat's Context. */
export function chatNewest(now: Date, pieces: PortfolioPiece[] | null, environment: "PAPER" | "LIVE" = "PAPER"): BuiltNewest {
  return composeNewest(CHAT, { now, environment, extra: UNPINNED }, { pieces });
}

/** The chat's instructions as one string. */
export function buildPrincipalSystemPrompt(opts: ChatPromptOpts): string {
  return chatRequest(opts).instructions;
}
