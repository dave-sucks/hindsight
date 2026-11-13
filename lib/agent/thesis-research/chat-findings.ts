/**
 * What the chat already found on a stock, for the Writer (2026-11-13): the
 * chat's web searches on that ticker, with their links, and our trade
 * results on it. Those are the only results the Writer can't pull itself.
 * Read from the conversation the dispatch was made in (the AI SDK hands
 * every tool call the messages so far, each result as the chat read it), so
 * the model doesn't retype them into research_notes, which keeps the chat's
 * own judgment.
 *
 * Nothing the Writer's pull already fetches by code is carried
 * (thesis-research/pull-data.ts: the news, filings, the catalyst and
 * earnings calendars, the quote, the Street): a second copy of an event date
 * beside the one on file is how EXEL's newer date nearly lost to an older one.
 * Newest first, each labeled by its tool, about 12,000 characters at most. Pure.
 */
import type { ModelMessage } from "ai";

export const CHAT_FOUND_MAX = 12_000;

type Data = Record<string, unknown>;
type Read = (data: Data, input: Data, T: string) => string[];

const arr = (v: unknown): Data[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Data[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const join = (...parts: unknown[]) => parts.map(str).filter(Boolean).join(" · ");
const isT = (row: Data, T: string) => str(row.ticker ?? row.symbol).toUpperCase() === T;
/** The ticker as written, $ or not, between word edges, never upper-cased: NOW, ON, IT, V and MA are words too. */
const asWritten = (text: unknown, T: string) => new RegExp(`(?<![A-Za-z0-9])\\$?${T.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`).test(str(text));
const names = (v: unknown, T: string) => Array.isArray(v) && v.some((x) => str(x).toUpperCase() === T);

/** A tool's rows on the stock, as the screen lists them (`data.items`, a row per ticker). */
const itemRows: Read = (data, _input, T) => arr(data.items).filter((i) => i.kind === "ticker" && isT(i, T)).map((i) => str(i.text)).filter(Boolean);

/** The two tools whose results the Writer can't pull itself, and how to read the stock's part. */
const READERS: Record<string, Read> = {
  // A search that asked about the stock, or a result that names it or lists it.
  web_search: (data, input, T) =>
    arr(data.results)
      .filter((r) => asWritten(input.query, T) || asWritten(r.headline, T) || asWritten(r.summary, T) || names(r.tickers, T))
      .map((r) => join(r.headline, r.summary, arr(r.sources).map((s) => str(s.url)).filter(Boolean).join(" "))),
  // Our closed trades on the stock, as the screen lists them.
  read_trade_results: itemRows,
};

/** The result's data, from the tool result as the chat read it (the envelope, or its model view). */
function dataOf(output: unknown): Data | null {
  const o = output as { type?: string; value?: unknown } | null;
  const v = (o?.type === "json" || o?.type === "content" ? o.value : output) as { data?: unknown } | null;
  return v?.data && typeof v.data === "object" ? (v.data as Data) : null;
}

/**
 * The "What the chat already found" text for one stock: each finding under
 * its tool's name, newest first, cut at `max` characters. Null when the
 * conversation holds nothing on the stock.
 */
export function chatFindings(ticker: string, messages: readonly ModelMessage[] | undefined, max = CHAT_FOUND_MAX): string | null {
  const T = ticker.toUpperCase();
  const inputs = new Map<string, Data>();
  const found: string[] = [];
  for (const m of messages ?? []) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as Array<{ type: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown }>) {
      if (part.type === "tool-call" && part.toolCallId) inputs.set(part.toolCallId, (part.input ?? {}) as Data);
      if (part.type !== "tool-result" || !part.toolName || !READERS[part.toolName]) continue;
      const data = dataOf(part.output);
      const input = inputs.get(part.toolCallId ?? "") ?? {};
      const lines = data ? READERS[part.toolName](data, input, T).filter(Boolean) : [];
      if (!lines.length) continue;
      const asked = str(input.query) ? ` "${str(input.query)}"` : "";
      found.push(`### ${part.toolName}${asked}\n${lines.map((l) => `- ${l}`).join("\n")}`);
    }
  }
  if (!found.length) return null;
  let out = "";
  for (const block of found.reverse()) {
    const next = out ? `${out}\n\n${block}` : block;
    if (next.length > max) {
      const room = max - out.length - 3;
      if (room > 200) out = `${out ? `${out}\n\n` : ""}${block.slice(0, room - 1)}…`;
      break;
    }
    out = next;
  }
  return out || null;
}
