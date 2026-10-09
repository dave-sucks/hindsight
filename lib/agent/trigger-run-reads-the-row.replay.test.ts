/**
 * trigger-run-reads-the-row.replay.test.ts — the trigger run reads its stock
 * the way every door reads it (step 10, docs/plans/AGENT_ARCHITECTURE.md
 * §11.6): get_theses on the ticker, the full row, with the fire as the lead
 * situation. Before step 10 it read the stock a second way, through its own
 * THESIS, THE SETUP and DEEP-RESEARCH EXCERPT blocks and a ladder of its own.
 *
 * Two production fires (lib/agent/__fixtures__/trigger-run-reads-2026-10.json):
 * DOCU 2026-09-28, the pullback buy at $67 on a watched stock; NVDA
 * 2026-10-08, the $236 floor on a held stock. Each goes through the real
 * get_theses execute at the moment of the fire, then the trigger run's own
 * `stockFromRead` and its prompt builder.
 */
import raw from "@/lib/agent/__fixtures__/trigger-run-reads-2026-10.json";
import { replayTool, thesisRow, positionRow, agentConfigRow, REPLAY_ANALYST_ID } from "@/lib/replay";
import { buildTacticalSystemPrompt, stockFromRead } from "@/lib/agent/system-prompts/intraday-tactical";
import { setupLines } from "@/lib/agent/analyst-brief";
import { getSetup } from "@/lib/agent/knowledge/setups";
import { SITUATIONS } from "@/lib/agent/situations";
import type { Trigger } from "@/lib/agent/triggers/types";

type Fire = { now: string; price: number; thesis: Record<string, unknown> & { id: string; ticker: string; triggers: Trigger[] }; fire: { triggerId: string; at: string; price: number; summary: string }; position?: Record<string, unknown>; answer?: Record<string, unknown> };
const fx = raw as unknown as { analyst: { name: string; setupIds: string[]; maxOpenPositions: number; minConfidence: number }; docu: Fire; nvda: Fire };

const DELETED = ["THESIS (id:", "THE SETUP THIS PLAN WAS WRITTEN ON", "DEEP-RESEARCH EXCERPT", "CURRENT TRIGGER LADDER", "POSITION:\n"];
/** What's been said arrives once, as the row's `said`, not as a block of its own. */
const saidOnce = (prompt: string, ticker: string) => {
  expect(prompt.split("WHAT'S BEEN SAID ON $").length - 1).toBe(1);
  expect(prompt).toContain(`"said": "WHAT'S BEEN SAID ON $${ticker}`);
};

async function triggerRun(c: Fire) {
  const t = c.thesis;
  jest.useFakeTimers({
    now: new Date(c.now),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: {
        agentConfig: [agentConfigRow({ name: fx.analyst.name, setupIds: fx.analyst.setupIds, maxOpenPositions: fx.analyst.maxOpenPositions })],
        thesis: [
          thesisRow({
            ...t,
            coreBelief: null, keyAssumptions: [], invalidationConds: [], snapshot: null, bullCase: null, bearCase: null, convictionRationale: null,
            createdAt: new Date(String(t.createdAt)),
            researchUpdatedAt: new Date(String(t.researchUpdatedAt)),
            lastReviewedAt: t.lastReviewedAt ? new Date(String(t.lastReviewedAt)) : null,
            researchRun: { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { name: fx.analyst.name, setupIds: fx.analyst.setupIds } },
          }),
        ],
        position: c.position
          ? [positionRow({ ...c.position, symbol: t.ticker, status: "OPEN", direction: "LONG", openedAt: new Date(String(c.position.openedAt)) })]
          : [],
        // The fire's own line, written before the run reads the stock; and the last answer before it.
        thesisUpdate: [
          ...(c.answer ? [{ id: "u_answer", thesisId: t.id, triggerId: null, fieldChanges: {}, rationale: null, runId: "run_answer", tradeId: null, signalIds: [], positionAtTime: null, ...c.answer, timestamp: new Date(String(c.answer.timestamp)), run: { mode: c.answer.runMode } }] : []),
          { id: "u_fire", thesisId: t.id, type: "TRIGGER_FIRED", triggerId: c.fire.triggerId, summary: c.fire.summary, rationale: null, fieldChanges: {}, runId: "run_fire", priceAtTime: c.fire.price, tradeId: null, signalIds: [], positionAtTime: null, timestamp: new Date(c.fire.at), run: { mode: "INTRADAY_TACTICAL" } },
        ],
      } as never,
      args: { tickers: [t.ticker] },
      ctx: { runMode: "INTRADAY_TACTICAL", maxOpenPositions: fx.analyst.maxOpenPositions, minConfidence: fx.analyst.minConfidence },
      quotes: { [t.ticker]: c.price },
    });
    const stock = stockFromRead(result, t.id);
    const trigger = t.triggers.find((x) => x.id === c.fire.triggerId)!;
    const prompt = buildTacticalSystemPrompt({
      analyst: fx.analyst,
      stock: { ticker: t.ticker, direction: String(t.direction), row: stock?.row ?? null },
      trigger,
      position: c.position ? { peakPrice: Number(c.position.peakPrice) } : null,
      fired: { price: c.fire.price },
      situations: stock?.situations ?? null,
    });
    return { stock, prompt };
  } finally {
    jest.useRealTimers();
  }
}

describe("DOCU 2026-09-28: the pullback buy, read through get_theses", () => {
  it("the full row leads with the fire, carries the setup's lines for its horizon and the fired buy with its id", async () => {
    const { stock, prompt } = await triggerRun(fx.docu);
    expect(stock).not.toBeNull();
    const row = stock!.row;
    expect((row.situations as string[])[0]).toBe("BUY_ARRIVES (buy level reached)");
    expect(stock!.situations.codes[0]).toBe("BUY_ARRIVES");
    expect(row.setup_lines).toEqual(setupLines(getSetup("MA_PULLBACK")!, "TARGET"));
    expect((row.triggers as string[]).find((l) => l.includes(`[id ${fx.docu.fire.triggerId}]`))).toMatch(/^Buy if below \$67 · fired 09-28 13:30 ET/);
    expect(prompt).toContain(JSON.stringify(row, null, 2));
    expect(prompt).toContain(SITUATIONS.BUY_ARRIVES.guidance);
    expect(prompt).toContain(`TRIGGER THAT FIRED (id: ${fx.docu.fire.triggerId})`);
    for (const name of DELETED) expect([name, prompt.includes(name)]).toEqual([name, false]);
    saidOnce(prompt, "DOCU");
  });
});

describe("NVDA 2026-10-08: the $236 floor on a held stock, read through get_theses", () => {
  it("the full row leads with the sale, carries the position, the PEAD lines and the fired floor with its id", async () => {
    const { stock, prompt } = await triggerRun(fx.nvda);
    expect(stock).not.toBeNull();
    const row = stock!.row;
    expect((row.situations as string[])[0]).toBe("PROTECTIVE_SALE (sale signal)");
    expect(row.position).toMatch(/^33 sh at \$218\.23 → \$234\.24 \(\+7\.3%\), \$7,730; opened 08-31; high since we bought \$242\.51$/);
    expect(row.setup_lines).toEqual(setupLines(getSetup("PEAD")!, "TARGET"));
    expect((row.triggers as string[]).find((l) => l.includes(`[id ${fx.nvda.fire.triggerId}]`))).toMatch(/^Sell if below \$236 · fired 10-08 13:31 ET/);
    expect(prompt).toContain(JSON.stringify(row, null, 2));
    expect(prompt).toContain(SITUATIONS.PROTECTIVE_SALE.guidance);
    expect(prompt).toContain(`TRIGGER THAT FIRED (id: ${fx.nvda.fire.triggerId})`);
    for (const name of DELETED) expect([name, prompt.includes(name)]).toEqual([name, false]);
    saidOnce(prompt, "NVDA");
  });
});
