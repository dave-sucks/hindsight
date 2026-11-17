/**
 * levels-gone.replay.test.ts — a stock has triggers and nothing else
 * (2026-11-16). HTFL (a watch) and MU (a holding), as production held them,
 * still carrying the three old level columns the drop migration removes:
 * get_theses' card and rows, and update_thesis' card, show the triggers'
 * sentences and what we paid, and never entry / target / stop.
 */
import fx from "@/lib/agent/__fixtures__/levels-gone-htfl-mu-2026-11-16.json";
import { replayTool, thesisRow, positionRow, agentConfigRow, REPLAY_USER_ID } from "@/lib/replay";

type Fx = { id: string; ticker: string; status: string; direction: string; horizon: string; setupId: string; analystId: string; oldColumns: Record<string, number | null>; triggers: unknown[] };
const htfl = fx.htfl as unknown as Fx;
const mu = fx.mu as unknown as Fx & { position: Record<string, unknown> };

const rowOf = (t: Fx) =>
  thesisRow({
    id: t.id, ticker: t.ticker, status: t.status, direction: t.direction, horizon: t.horizon, setupId: t.setupId,
    triggers: t.triggers, analystId: t.analystId,
    // The columns still sit on the production rows until the drop migration; nothing may read them.
    ...t.oldColumns,
  });
const seed = (analystId: string) => ({
  agentConfig: [agentConfigRow({ id: analystId })],
  thesis: [rowOf(htfl), rowOf(mu)].filter((t) => (t.researchRun as { agentConfigId: string }).agentConfigId === analystId),
  position: [positionRow({ ...mu.position, symbol: "MU", analystId: mu.analystId, openedAt: new Date(mu.position.openedAt as string) })],
});

const OLD_KEYS = /entry_?price|target_?price|stop_?loss/i;

async function read(t: Fx) {
  const args = { tickers: [t.ticker] };
  const { result, crashed } = await replayTool("get-theses", "getTheses", { seed: seed(t.analystId), args, ctx: { analystId: t.analystId, runEnvironment: "LIVE" }, quotes: fx.quotes });
  if (crashed) throw new Error(JSON.stringify(result).slice(0, 2000));
  // Imported in a registry of its own: a plain import here would leak into the next replay's modules.
  let mod!: typeof import("@/lib/agent/tools/get-theses");
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    mod = await import("@/lib/agent/tools/get-theses");
  });
  const tool = mod.getTheses({ runId: "r", userId: REPLAY_USER_ID, analystId: t.analystId } as never) as unknown as {
    toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: { data: Record<string, unknown> } };
  };
  const data = result.data as { cards: Array<Record<string, unknown>> };
  const model = tool.toModelOutput({ toolCallId: "c", input: args, output: result }).value.data;
  return { card: data.cards[0], model, screen: result.data };
}

async function save(t: Fx) {
  const { result, crashed } = await replayTool("update-thesis", "updateThesis", {
    seed: seed(t.analystId),
    args: { thesis_id: t.id, rationale: `Reviewed ${t.ticker}: the triggers stand as written, nothing in the business has changed since the last look.` },
    ctx: { analystId: t.analystId, runMode: "MORNING_PLAN", runEnvironment: "LIVE" },
    quotes: fx.quotes,
  });
  if (crashed) throw new Error(JSON.stringify(result).slice(0, 2000));
  return (result.data as { card: Record<string, unknown> }).card;
}

describe("HTFL, a watch: its triggers as their sentences, and no level of ours", () => {
  it("the get_theses card", async () => {
    const { card } = await read(htfl);
    expect(card.triggers).toEqual([
      "Buy if above $51.94 · only on the close",
      "Stop watching if below $46.50 · only on the close",
      "Review if above $60.56",
    ]);
    expect(card.paid).toBeNull();
    expect(Object.keys(card).filter((k) => OLD_KEYS.test(k))).toEqual([]);
  });

  it("the get_theses row the model reads, and the screen's row", async () => {
    const { model, screen } = await read(htfl);
    expect(JSON.stringify(model)).not.toMatch(OLD_KEYS);
    expect(JSON.stringify(model)).toContain("Buy if above $51.94 · only on the close");
    expect(JSON.stringify(screen)).not.toMatch(/"(entryPrice|targetPrice|stopLoss)"/);
  });

  it("the update_thesis card", async () => {
    const card = await save(htfl);
    expect(card.triggers).toEqual([
      "Buy if above $51.94 · only on the close",
      "Stop watching if below $46.50 · only on the close",
      "Review if above $60.56",
    ]);
    expect(card.paid).toBeNull();
    expect(Object.keys(card).filter((k) => OLD_KEYS.test(k))).toEqual([]);
  });
});

describe("MU, a holding: its triggers as their sentences, and what we paid", () => {
  it("the get_theses card", async () => {
    const { card } = await read(mu);
    expect(card.triggers).toEqual(expect.arrayContaining(["Sell if below $804", "Review if below $878", "Review every 30 days"]));
    expect(card.paid).toBe(911.415);
    expect(Object.keys(card).filter((k) => OLD_KEYS.test(k))).toEqual([]);
  });

  it("the get_theses row the model reads says what we paid off the position, never a cached entry", async () => {
    const { model, screen } = await read(mu);
    const text = JSON.stringify(model);
    expect(text).not.toMatch(OLD_KEYS);
    expect(text).toContain("11 sh at $911.42");
    expect(text).toContain("Sell if below $804");
    expect(JSON.stringify(screen)).not.toMatch(/"(entryPrice|targetPrice|stopLoss)"/);
  });

  it("the update_thesis card", async () => {
    const card = await save(mu);
    expect(card.triggers).toEqual(expect.arrayContaining(["Sell if below $804"]));
    expect(card.paid).toBe(911.415);
    expect(Object.keys(card).filter((k) => OLD_KEYS.test(k))).toEqual([]);
  });
});
