/**
 * old-lookups.ts — the chat never reads an old lookup as today's numbers.
 *
 * A chat is one long thread. On 2026-11-04 the owner came back to a chat
 * begun Oct 27, and it told him MU was $932.24 (+2.28%) and up on his cost.
 * That was its Oct 27 get_portfolio_context result, read back word for word;
 * MU was at $808, down 11% on the cost. Nothing told the model what day it
 * was or when a lookup ran.
 *
 * So: every message from the owner reaches the model with the time on it, and a
 * lookup older than LOOKUP_SHELF_LIFE_MS reaches it as one line saying when it
 * ran and to look again. A change the chat made (a trade, an edit, a note)
 * keeps its result, so the chat never redoes one it already made.
 */
import type { ModelMessage, UIMessage } from "ai";
import { isMarketOpen } from "@/lib/market-hours";

export const LOOKUP_SHELF_LIFE_MS = 15 * 60_000;

/** Tools that change something. Their results are the record of what was done. */
const CHANGES = new Set([
  "record_thesis",
  "update_thesis",
  "place_trade",
  "manage_position",
  "close_position",
  "write_note",
  "dispatch_thesis_research",
  "ask_question",
  "suggest_config",
]);

const ET = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...opts });
const whenET = (d: Date) => `${ET({ month: "short", day: "numeric" }).format(d)}, ${ET({ hour: "numeric", minute: "2-digit" }).format(d)} ET`;

function howLongAgo(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 120) return `${min} minutes`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

/** The earlier turns with every old lookup replaced by when it ran and "look again". */
export function hideOldLookups<M extends Omit<UIMessage, "id">>(messages: M[], now: Date): M[] {
  return messages.map((m) => {
    let changed = false;
    const parts = m.parts.map((part) => {
      const p = part as { type: string; state?: string; output?: unknown };
      if (!p.type.startsWith("tool-") || p.state !== "output-available") return part;
      const tool = p.type.slice("tool-".length);
      if (CHANGES.has(tool)) return part;
      const at = (p.output as { at?: unknown } | null)?.at;
      const ran = typeof at === "string" ? new Date(at) : null;
      if (ran && !Number.isNaN(ran.getTime()) && now.getTime() - ran.getTime() <= LOOKUP_SHELF_LIFE_MS) return part;
      changed = true;
      const when = ran
        ? `This ${tool} lookup ran ${whenET(ran)}, ${howLongAgo(now.getTime() - ran.getTime())} ago.`
        : `This ${tool} lookup ran in an earlier session.`;
      return {
        ...part,
        state: "output-error",
        output: undefined,
        errorText: `${when} Its numbers are out of date and hidden. Call ${tool} again for current ones.`,
      } as typeof part;
    });
    return changed ? { ...m, parts } : m;
  });
}

/**
 * The newest owner message, with the time in front of it and, when given, the
 * account's Market and portfolio block (lib/agent/portfolio-block.ts). Both
 * ride on the newest message, not the system prompt, so the system prompt and
 * the history before it stay cached between messages.
 */
export function withTheTime(messages: ModelMessage[], now: Date, context?: string | null): ModelMessage[] {
  const i = messages.findLastIndex((m) => m.role === "user");
  if (i < 0) return messages;
  const market = isMarketOpen(now) ? "the market is open" : "the market is closed";
  const line = `[${ET({ weekday: "short" }).format(now)} ${whenET(now)}, ${market}. A price in an earlier message is from when that message was written.]`;
  const m = messages[i] as Extract<ModelMessage, { role: "user" }>;
  const content = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
  const out = [...messages];
  out[i] = { ...m, content: [{ type: "text", text: line }, ...(context ? [{ type: "text" as const, text: context }] : []), ...content] };
  return out;
}
