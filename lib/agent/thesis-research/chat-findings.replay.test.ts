/**
 * The Writer gets what the chat found (2026-11-13). The PRAX discovery chat
 * read the catalyst calendar, 13D filings, the day's movers and nine stocks'
 * data, then sent PRAX to the Writer with a typed summary. The Writer's run
 * searched the web three times, twice for what the chat had read: the
 * investor-day news and the PDUFA date.
 *
 * The fixture is that chat as the dispatch tool received it: the saved
 * thread up to the owner's pick, converted the way the chat route converts
 * it (convertToModelMessages with the chat's tools), cut to the calls
 * chatFindings reads (lib/agent/__fixtures__/chat-found-prax-2026-11-13.json).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import type { ModelMessage } from "ai";
import fixture from "@/lib/agent/__fixtures__/chat-found-prax-2026-11-13.json";
import { chatFindings, CHAT_FOUND_MAX } from "@/lib/agent/thesis-research/chat-findings";
import { defineTool } from "@/lib/agent/define-tool";
import { z } from "zod";

const messages = (fixture as unknown as { messages: ModelMessage[] }).messages;
const call = (id: string, toolName: string, input: unknown): ModelMessage => ({ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName, input }] });
const result = (id: string, toolName: string, data: unknown): ModelMessage => ({ role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName, output: { type: "json", value: { summary: "", data } as never } }] });

describe("what the PRAX chat found, as the Writer gets it", () => {
  const found = chatFindings("PRAX", messages)!;

  it("carries PRAX's news and its PDUFA row with their links, each under its tool, newest call first", () => {
    expect(found.split("\n").filter((l) => l.startsWith("### "))).toEqual(["### get_stock_data", "### get_catalyst_calendar"]);
    expect(found).toContain("Praxis Precision Medicines Details Launch Readiness for Relutrigine and Ulixacaltamide");
    expect(found).toContain("PDUFA · 2026-12-27 · announced 2026-11-09");
    expect(found).toContain("https://www.sec.gov/Archives/edgar/data/1689548/000168954826000086/praxisq32026pr.htm");
    expect(found.length).toBe(3423);
  });

  it("carries nothing on the other stocks the chat read, and none of what the Writer pulls fresh", () => {
    expect(found).not.toMatch(/\bCOGT\b|\bVRTX\b|\bCAPR\b/);
    expect(found).not.toMatch(/"quote"|priceTargets|analystConsensus|financials/);
  });

  it("another stock the chat read gets its own news, and none of PRAX's", () => {
    expect(chatFindings("VRTX", messages)).toMatch(/^### get_stock_data\n- /);
    expect(chatFindings("VRTX", messages)).not.toContain("Praxis");
  });
});

describe("the rules", () => {
  it("a web search is carried when it asked about the stock or a result names it, with its links", () => {
    const m = [
      call("a", "web_search", { query: "PRAX PDUFA extension reason" }),
      result("a", "web_search", { query: "PRAX PDUFA extension reason", results: [{ headline: "FDA extends review", summary: "a major amendment", tickers: [], sources: [{ url: "https://x.test/1" }] }] }),
      call("b", "web_search", { query: "biotech calendar December" }),
      result("b", "web_search", { results: [{ headline: "Dates", summary: "nothing here", tickers: ["SRPT"] }, { headline: "PRAX date", summary: "Dec 27", tickers: ["PRAX"] }] }),
    ];
    expect(chatFindings("PRAX", m)).toBe('### web_search "biotech calendar December"\n- PRAX date · Dec 27\n\n### web_search "PRAX PDUFA extension reason"\n- FDA extends review · a major amendment · https://x.test/1');
  });

  it("nothing on the stock is no section; a long one is cut at the cap, newest kept", () => {
    expect(chatFindings("ZZZ", messages)).toBeNull();
    const big = Array.from({ length: 40 }, (_, i) => [call(`c${i}`, "get_stock_data", { ticker: "PRAX" }), result(`c${i}`, "get_stock_data", { news: [{ headline: `item ${i} `.padEnd(400, "x") }] })]).flat();
    const out = chatFindings("PRAX", big)!;
    expect(out.length).toBeLessThanOrEqual(CHAT_FOUND_MAX);
    expect(out.startsWith("### get_stock_data\n- item 39 ")).toBe(true);
  });

  it("a tool gets the conversation it was called in, as the AI SDK hands it over", async () => {
    let seen: unknown;
    const t = defineTool({ description: "probe", schema: z.object({}), ui: "tool-ui", execute: async (_args, _ctx, c) => ((seen = c?.messages), { summary: "", data: {} }) });
    const instance = t({ runId: "r", groupId: (g: string) => g } as never) as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> };
    await instance.execute({}, { toolCallId: "x", messages });
    expect(seen).toBe(messages);
  });
});
