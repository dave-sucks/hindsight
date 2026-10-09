/**
 * get-theses.account-read.replay.test.ts — the read with no analyst, the chat's
 * account-wide view since step 10 (docs/plans/AGENT_ARCHITECTURE.md §11.6).
 *
 * Before this, the read's loaders keyed everything on the reader's analyst, so
 * with none: a stock inherited no analyst or account rules, a held stock took
 * whichever analyst's position on that ticker was newest, pending buys were
 * never seen, one analyst's passed thesis could mark another analyst's live
 * one superseded, the read stopped at 25 stocks without saying so, and no row
 * said whose it was. Each stock now resolves with its own analyst.
 *
 * Two analysts both hold NVDA; the PEAD one carries a trail rule its stocks
 * inherit and a buy awaiting approval on MU; the Compounder passed on NVDA
 * after the PEAD one bought it. Through the real get_theses execute.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, REPLAY_USER_ID } from "@/lib/replay";

const PEAD = "an_pead";
const COMP = "an_comp";
const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const onAnalyst = (id: string, name: string) => ({ agentConfigId: id, agentConfig: { name, setupIds: [], minConfidence: 60 } });
const trail = { id: "pead_trail", action: "EXIT", predicate: { watch: "move", is: "below", value: 12, variable: "peak" }, rationale: "The analyst's trail.", cooldownDays: 0 };

function seed() {
  return {
    agentConfig: [
      agentConfigRow({ id: PEAD, name: "PEAD Specialist", triggers: [trail] }),
      agentConfigRow({ id: COMP, name: "Secular Compounder" }),
    ],
    thesis: [
      thesisRow({ id: "t_nvda_pead", ticker: "NVDA", status: "HOLDING", entryPrice: 200, targetPrice: 300, stopLoss: 180, triggers: [], createdAt: days(40), updatedAt: days(1), researchRun: onAnalyst(PEAD, "PEAD Specialist") }),
      thesisRow({ id: "t_nvda_comp", ticker: "NVDA", status: "HOLDING", entryPrice: 150, targetPrice: 320, stopLoss: 130, triggers: [], createdAt: days(60), updatedAt: days(2), researchRun: onAnalyst(COMP, "Secular Compounder") }),
      // The Compounder passed on NVDA after the PEAD analyst bought it: its own row only, never the PEAD one's.
      thesisRow({ id: "t_nvda_comp_pass", ticker: "NVDA", status: "PASSED", direction: null, createdAt: days(5), updatedAt: days(5), researchRun: onAnalyst(COMP, "Secular Compounder") }),
      // A watched stock whose buy is live and already awaiting approval.
      thesisRow({ id: "t_mu_pead", ticker: "MU", status: "WATCHING", entryPrice: 110, targetPrice: 150, stopLoss: 100, triggers: [{ id: "mu_buy", action: "ENTER", predicate: { watch: "price", is: "below", value: 110 }, rationale: "The buy level.", cooldownDays: 1 }], createdAt: days(20), updatedAt: days(3), researchRun: onAnalyst(PEAD, "PEAD Specialist") }),
    ],
    position: [
      positionRow({ id: "p_nvda_pead", analystId: PEAD, symbol: "NVDA", quantity: 10, avgCost: 200, peakPrice: 260, openedAt: days(30) }),
      positionRow({ id: "p_nvda_comp", analystId: COMP, symbol: "NVDA", quantity: 5, avgCost: 150, peakPrice: 260, openedAt: days(50) }),
      positionRow({ id: "p_mu_pending", analystId: PEAD, symbol: "MU", status: "PENDING_APPROVAL", quantity: 30, avgCost: 105, openedAt: days(0) }),
    ],
    thesisUpdate: [],
  };
}

type Data = { theses: Array<Record<string, unknown>>; quiet_theses: Array<Record<string, unknown>>; left_out?: string; sold_to_review?: unknown };

async function read(args: Record<string, unknown>, ctx: Record<string, unknown> = {}) {
  const { result } = await replayTool("get-theses", "getTheses", {
    seed: seed() as never,
    args,
    // The chat with no analyst: no analystId, no analyst's limits.
    ctx: { runMode: "PRINCIPAL_CHAT", userId: REPLAY_USER_ID, analystId: undefined, maxOpenPositions: undefined, minConfidence: undefined, ...ctx },
    quotes: { NVDA: 240, MU: 105 },
  });
  const screen = result.data as unknown as Data;
  const { getTheses } = await import("@/lib/agent/tools/get-theses");
  const tool = getTheses({ runId: "r", userId: REPLAY_USER_ID } as never) as unknown as {
    toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: { data: Record<string, unknown> } };
  };
  const model = tool.toModelOutput({ toolCallId: "c1", input: args, output: result }).value.data;
  return { screen, model };
}

const all = (d: Data) => [...d.theses, ...d.quiet_theses];
const byId = (d: Data, id: string) => all(d).find((t) => t.id === id)!;

describe("get_theses with no analyst: each stock with its own analyst", () => {
  it("inherits its own analyst's rules: the PEAD trail on PEAD's NVDA, not on the Compounder's", async () => {
    const { screen } = await read({ detail: "book" });
    const inherited = (id: string) => ((byId(screen, id).inheritedTriggers ?? []) as Array<{ id: string }>).map((t) => t.id);
    expect(inherited("t_nvda_pead")).toContain("pead_trail");
    expect(inherited("t_nvda_comp")).not.toContain("pead_trail");
  });

  it("counts its own analyst's position, never the other's on the same ticker", async () => {
    const { screen } = await read({ detail: "book" });
    expect(byId(screen, "t_nvda_pead").position).toMatchObject({ quantity: 10, avgCost: 200 });
    expect(byId(screen, "t_nvda_comp").position).toMatchObject({ quantity: 5, avgCost: 150 });
  });

  it("sees its own analyst's pending buy: MU's live buy is not flagged again", async () => {
    const { screen } = await read({ detail: "book" });
    const lead = byId(screen, "t_mu_pead").needsAction as { kind?: string; action?: string } | null;
    expect(lead?.action).not.toBe("ENTER");
  });

  it("is superseded only by its own analyst's newer row", async () => {
    const { screen } = await read({ detail: "book" });
    const superseded = (id: string) => (byId(screen, id).resolved as { supersededBy?: unknown } | null)?.supersededBy ?? null;
    expect(superseded("t_nvda_pead")).toBeNull();
  });

  it("names each stock's analyst: last on the one line, an `analyst` key on the row", async () => {
    const { model } = await read({});
    const lines = (model.quiet_theses as string[]) ?? [];
    const rows = (model.theses as Array<Record<string, unknown>>) ?? [];
    for (const l of lines) expect(l).toMatch(/ · (PEAD Specialist|Secular Compounder)$/);
    for (const r of rows) expect(["PEAD Specialist", "Secular Compounder"]).toContain(r.analyst);
    expect(lines.length + rows.length).toBe(3);
  });

  it("a read that reaches its cap says how many it left out, as its last line", async () => {
    const { model } = await read({ limit: 2 });
    expect(model.left_out).toBe("1 more stock matches this read and is not shown; ask for it by ticker, status or horizon.");
    expect(Object.keys(model).at(-1)).toBe("left_out");
  });

  it("carries no buy-blocked-full fact and no sold_to_review: both need one analyst", async () => {
    const { screen, model } = await read({ detail: "book" });
    for (const t of all(screen)) expect(t.buyBlockedByFull ?? null).toBeNull();
    expect(screen.sold_to_review).toBeUndefined();
    expect(model.sold_to_review).toBeUndefined();
  });
});

describe("get_theses for one analyst: unchanged", () => {
  it("names no analyst on any row or line, and leaves nothing out at this size", async () => {
    const { model } = await read({}, { analystId: PEAD, runMode: "MORNING_PLAN", maxOpenPositions: 6, minConfidence: 60 });
    expect(JSON.stringify(model)).not.toMatch(/PEAD Specialist|Secular Compounder|"analyst"/);
    expect(model).not.toHaveProperty("left_out");
  });
});
