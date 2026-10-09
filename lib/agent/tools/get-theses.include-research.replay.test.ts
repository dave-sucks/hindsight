/**
 * get-theses.include-research.replay.test.ts — the research sections on a
 * read of a named stock with include_research (Roadmap step 8): the full row
 * carries the ones the stock has, as text with the screen's citations
 * removed; without include_research the read does not load them.
 *
 * No recorded run asked for them (none in the cases, none in production in
 * the 30 days to 2026-10-08), so this drives the real tool with a stock
 * carrying them in the three shapes the writer saves.
 */
import { replayTool, thesisRow } from "@/lib/replay";

const sections = {
  recentCatalysts: { text: "Mako volumes grew 20% [WEB:https://example.com/m].", citations: [{ url: "https://example.com/m", kind: "WEB", domain: "example.com" }] },
  latestEarnings: { bullets: [{ text: "**Beat** on both lines [STRUCTURED:Earnings History]", citation: { kind: "STRUCTURED", title: "Earnings History" } }] },
  researchData: "Raw notes [STRUCTURED:Snapshot].",
};
const syk = () => thesisRow({ id: "t_syk", ticker: "SYK", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER", entryPrice: 340, targetPrice: 420, stopLoss: 300, ...sections });

const replay = async (args: Record<string, unknown>) => {
  const { result, calls } = await replayTool("get-theses", "getTheses", { seed: { thesis: [syk()] }, ctx: { runMode: "MORNING_PLAN" }, args, quotes: { SYK: 273 } });
  expect(calls).toContain("thesis.findMany");
  return { args, result };
};

/**
 * The model's row through the tool's real model-output hook. Loaded after
 * every replay has run: once get_theses is imported outside the replay's
 * isolated modules, a later replay in the same file reads the earlier one's
 * database (found 2026-10-08; the guard above fails if it ever does).
 */
async function modelRows(reads: Array<{ args: Record<string, unknown>; result: unknown }>) {
  const { getTheses } = await import("@/lib/agent/tools/get-theses");
  const tool = getTheses({ runId: "r", userId: "u", analystId: "a" } as never) as unknown as {
    toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: { data: { theses: Array<Record<string, unknown>> } } };
  };
  return reads.map(({ args, result }) => ({
    model: tool.toModelOutput({ toolCallId: "c1", input: args, output: result }).value.data.theses[0],
    screen: (result as { data: { theses: Array<Record<string, unknown>> } }).data.theses[0],
  }));
}

describe("get_theses — include_research on a named read", () => {
  it("the model's full row carries the sections, the citations and tags gone; the screen keeps them as saved; without it, none load", async () => {
    const [asked, plain] = await modelRows([await replay({ tickers: ["SYK"], include_research: true }), await replay({ tickers: ["SYK"] })]);
    expect(asked.model.recentCatalysts).toBe("Mako volumes grew 20%.");
    expect(asked.model.latestEarnings).toEqual(["Beat on both lines"]);
    expect(asked.model.researchData).toBe("Raw notes.");
    expect(JSON.stringify(asked.model)).not.toMatch(/\[(STRUCTURED|WEB)|example\.com/);
    expect(asked.screen.recentCatalysts).toEqual(sections.recentCatalysts);

    for (const k of Object.keys(sections)) {
      expect(plain.screen[k] ?? null).toBeNull();
      expect(plain.model).not.toHaveProperty(k);
    }
  });
});
