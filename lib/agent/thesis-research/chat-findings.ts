/**
 * What the chat already found on a stock, for the Writer (2026-11-13). The
 * results of the chat's own calls on that ticker that code can't pull again,
 * read from the conversation the dispatch was made in: the AI SDK hands
 * every tool call the messages so far, each result as the chat read it.
 * Code carries them, so the model doesn't retype them into research_notes,
 * which keeps the chat's own judgment.
 *
 * Left out: what the Writer pulls fresh by code (the snapshot, prices,
 * earnings, the Street; thesis-research/pull-data.ts). Newest first, each
 * labeled by its tool, about 12,000 characters at most. Pure.
 */
import type { ModelMessage } from "ai";

export const CHAT_FOUND_MAX = 12_000;

type Data = Record<string, unknown>;
type Read = (data: Data, input: Data, T: string) => string[];

const arr = (v: unknown): Data[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Data[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const join = (...parts: unknown[]) => parts.map(str).filter(Boolean).join(" · ");
const isT = (row: Data, T: string) => str(row.ticker ?? row.symbol).toUpperCase() === T;
const about = (text: unknown, T: string) => new RegExp(`(^|[^A-Z])\\$?${T.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z]|$)`).test(str(text).toUpperCase());
const names = (v: unknown, T: string) => Array.isArray(v) && v.some((x) => str(x).toUpperCase() === T);

/** A tool's rows on the stock, as the screen lists them (`data.items`, a row per ticker). */
const itemRows: Read = (data, _input, T) => arr(data.items).filter((i) => i.kind === "ticker" && isT(i, T)).map((i) => str(i.text)).filter(Boolean);

/** Each tool whose result holds something the Writer can't pull again, and how to read the stock's part. */
const READERS: Record<string, Read> = {
  web_search: (data, input, T) =>
    arr(data.results)
      .filter((r) => about(input.query, T) || about(r.headline, T) || about(r.summary, T) || names(r.tickers, T))
      .map((r) => join(r.headline, r.summary, arr(r.sources).map((s) => str(s.url)).filter(Boolean).join(" "))),
  get_catalyst_calendar: (data, _input, T) => arr(data.events).filter((e) => isT(e, T)).map((e) => join(e.kind, e.eventDate, e.announcedDate && `announced ${str(e.announcedDate)}`, e.quote, e.url)),
  get_sec_filings: (data, input, T) => [
    ...arr(data.filings).filter((f) => isT(f, T)).map((f) => join(f.type, f.date, f.description, Array.isArray(f.items) && f.items.length ? `items ${f.items.join(", ")}` : "", f.url)),
    ...arr(data.rows).filter((r) => isT(r, T)).map((r) => join(JSON.stringify(r.stakes ?? r).slice(0, 600))),
    ...itemRows(data, input, T),
  ],
  // The quote, the numbers and the chart the Writer pulls again; the news it read it can't.
  get_stock_data: (data, input, T) =>
    str(input.ticker).toUpperCase() === T ? arr(data.news).map((n) => join(n.datetime ?? n.date ?? n.publishedAt, n.headline, n.summary, n.url)) : [],
  get_earnings_calendar: itemRows,
  get_market_movers: itemRows,
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
