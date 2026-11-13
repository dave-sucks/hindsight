/**
 * The Writer gets what the chat found (2026-11-13): the chat's web searches
 * on the stock, with their links. Nothing the Writer's own pull fetches (the
 * news, filings, the calendars, the quote, our trades on the stock).
 *
 * Two real chats, each as the dispatch tool received it: the saved thread up
 * to the dispatch, converted the way the chat route converts it
 * (convertToModelMessages with the chat's tools).
 * - PRAX, 2026-11-13 (cmwehwgvo000008jqgsmkskq9): read the catalyst
 *   calendar, 13D filings, the movers and nine stocks' data, and ran no web
 *   search. Cut to those calls (chat-found-prax-2026-11-13.json).
 * - AAOI, 2026-11-08 (cmw70zke9000208l0f6xs8mvd): one web search on AAOI,
 *   then sent it. The Writer's run searched twice, for the Q3 guide and the
 *   1.6T supply constraint, both in what that search had returned. Cut to the
 *   web_search call (chat-found-aaoi-2026-11-08.json).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import type { ModelMessage } from "ai";
import prax from "@/lib/agent/__fixtures__/chat-found-prax-2026-11-13.json";
import aaoi from "@/lib/agent/__fixtures__/chat-found-aaoi-2026-11-08.json";
import { chatFindings, CHAT_FOUND_MAX } from "@/lib/agent/thesis-research/chat-findings";
import { defineTool } from "@/lib/agent/define-tool";
import { z } from "zod";

const praxChat = (prax as unknown as { messages: ModelMessage[] }).messages;
const aaoiChat = (aaoi as unknown as { messages: ModelMessage[] }).messages;
const call = (id: string, toolName: string, input: unknown): ModelMessage => ({ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName, input }] });
const result = (id: string, toolName: string, data: unknown): ModelMessage => ({ role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName, output: { type: "json", value: { summary: "", data } as never } }] });
const search = (id: string, query: string, results: unknown[]) => [call(id, "web_search", { query }), result(id, "web_search", { query, results })];

describe("two real chats, as the Writer gets them", () => {
  it("PRAX: the chat read the news, the PDUFA row, filings and movers, all of which the Writer pulls itself, so nothing is carried", () => {
    expect(chatFindings("PRAX", praxChat)).toBeNull();
  });

  it("AAOI: the chat's one search, its four results with their links", () => {
    const found = chatFindings("AAOI", aaoiChat)!;
    expect(found.split("\n")[0]).toBe('### web_search "Applied Optoelectronics AAOI Q3 2026 earnings results shipment delays guidance"');
    expect(found.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(4);
    expect(found).toContain("AAOI guided Q4 2026 revenue to $385 million-$420 million");
    expect(found).toContain("https://finance.yahoo.com/markets/stocks/articles/aaoi-q3-earnings-call-highlights-140000089.html");
    expect(found.length).toBe(2847);
  });
});

describe("the rules", () => {
  it("a ticker that is also a word is matched as written, never upper-cased", () => {
    const m = search("a", "software stocks to watch now", [
      { headline: "Stocks rise now on rate hopes", summary: "it is on", tickers: [] },
      { headline: "$NOW beats on subscriptions", summary: "ServiceNow raised", tickers: [] },
      { headline: "Workflow software", summary: "a leader", tickers: ["NOW"] },
    ]);
    expect(chatFindings("NOW", m)).toBe('### web_search "software stocks to watch now"\n- $NOW beats on subscriptions · ServiceNow raised\n- Workflow software · a leader');
    expect(chatFindings("ON", m)).toBeNull();
    expect(chatFindings("NOW", search("b", "NOW guidance raise", [{ headline: "Guidance", summary: "raised", tickers: [] }]))).toBe('### web_search "NOW guidance raise"\n- Guidance · raised');
  });

  it("the pull's own tools are never carried, our trade results included (the Writer's data block has them)", () => {
    const m = [
      call("t", "read_trade_results", { ticker: "AAOI" }),
      result("t", "read_trade_results", { items: [{ kind: "ticker", ticker: "AAOI", text: "Sold 2026-10-02 at the stop, −8.1%" }, { kind: "ticker", ticker: "MU", text: "won" }] }),
      call("n", "get_stock_data", { ticker: "AAOI" }),
      result("n", "get_stock_data", { news: [{ headline: "AAOI news" }] }),
      call("c", "get_catalyst_calendar", {}),
      result("c", "get_catalyst_calendar", { events: [{ ticker: "AAOI", kind: "EARNINGS", eventDate: "2027-02-25" }] }),
    ];
    expect(chatFindings("AAOI", m)).toBeNull();
  });

  it("nothing on the stock is no section; a long one is cut at the cap, newest kept", () => {
    expect(chatFindings("ZZZ", aaoiChat)).toBeNull();
    const big = Array.from({ length: 40 }, (_, i) => search(`c${i}`, `AAOI item ${i}`, [{ headline: `item ${i} `.padEnd(400, "x"), tickers: [] }])).flat();
    const out = chatFindings("AAOI", big)!;
    expect(out.length).toBeLessThanOrEqual(CHAT_FOUND_MAX);
    expect(out.startsWith('### web_search "AAOI item 39"')).toBe(true);
  });

  it("a tool gets the conversation it was called in, as the AI SDK hands it over", async () => {
    let seen: unknown;
    const t = defineTool({ description: "probe", schema: z.object({}), ui: "tool-ui", execute: async (_args, _ctx, c) => ((seen = c?.messages), { summary: "", data: {} }) });
    const instance = t({ runId: "r", groupId: (g: string) => g } as never) as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> };
    await instance.execute({}, { toolCallId: "x", messages: aaoiChat });
    expect(seen).toBe(aaoiChat);
  });
});
