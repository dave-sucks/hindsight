import { TOOL_DOCS, agentToolLists, buildToolCatalog, podcastOnlyTools } from "./tool-catalog";

describe("the /docs tool catalog matches the agents' tool lists", () => {
  it("documents every tool an agent is given", () => {
    const given = new Set(Object.values(agentToolLists()).flatMap((s) => [...s]));
    const missing = [...given].filter((t) => !(t in TOOL_DOCS));
    expect(missing).toEqual([]);
  });

  it("documents no tool that no agent has", () => {
    const orphans = buildToolCatalog().filter((t) => t.agents.length === 0).map((t) => t.code);
    expect(orphans).toEqual([]);
  });

  it("keeps the podcast feature's tools off the page", () => {
    for (const t of podcastOnlyTools()) expect(TOOL_DOCS[t]).toBeUndefined();
  });

  it("marks every trade as needing approval", () => {
    const trades = buildToolCatalog().filter((t) => t.kind === "trade");
    expect(trades.map((t) => t.code).sort()).toEqual(["close_position", "manage_position", "place_trade"]);
    for (const t of trades) expect(t.approval).toBe(true);
  });
});
