import { extractResearchedTickers } from "./researched-tickers";

describe("extractResearchedTickers", () => {
  it("reads ModelMessage content[] tool calls — the shape a chat turn persists", () => {
    // Mirrors the 2026-08-25 Catalyst thread: assistant turn with a batch
    // of get_stock_data calls before the record_thesis retry.
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Pulling quotes." },
          { type: "tool-call", toolName: "get_stock_data", input: { ticker: "AGIO" } },
          { type: "tool-call", toolName: "get_stock_data", input: { ticker: "svra" } },
          { type: "tool-call", toolName: "record_thesis", input: { ticker: "LGMK" } },
        ],
      },
    ];
    const out = extractResearchedTickers(messages);
    expect(out.sort()).toEqual(["AGIO", "SVRA"]);
    // record_thesis is not research — it must not satisfy its own gate.
    expect(out).not.toContain("LGMK");
  });

  it("reads UIMessage parts[] where the tool name is folded into the type", () => {
    const messages = [
      {
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "tool-get_stock_data", input: { ticker: "PEN" } },
        ],
      },
    ];
    expect(extractResearchedTickers(messages)).toEqual(["PEN"]);
  });

  it("accepts the legacy `args` bag as well as `input`", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool-call", toolName: "get_stock_data", args: { ticker: "IBRX" } }] },
    ];
    expect(extractResearchedTickers(messages)).toEqual(["IBRX"]);
  });

  it("dedupes across turns and ignores malformed entries", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool-call", toolName: "get_stock_data", input: { ticker: "TBPH" } }] },
      { role: "assistant", parts: [{ type: "tool-get_stock_data", input: { ticker: "TBPH" } }] },
      { role: "assistant", content: [{ type: "tool-call", toolName: "get_stock_data" }] },
      { role: "assistant", content: "not an array" },
      null,
      { role: "user", parts: [{ type: "text", text: "$NVDA looks good" }] },
    ];
    expect(extractResearchedTickers(messages)).toEqual(["TBPH"]);
  });

  it("returns empty for anything that is not a message array", () => {
    expect(extractResearchedTickers(null)).toEqual([]);
    expect(extractResearchedTickers({})).toEqual([]);
    expect(extractResearchedTickers("[]")).toEqual([]);
  });
});
