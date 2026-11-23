/**
 * The Portfolio Manager may send a stock no analyst holds or watches to
 * research: a new watch, for the analyst it names. Until now the send was
 * refused ("…so there is no thesis to refresh"). The analysts are the
 * account's on 2026-11-23: three on the live book, one on paper, one paused.
 * No run had made this call before the change, so the stock is a stand-in.
 * One new stock a run (NEW_STOCKS_A_RUN); any other run's send is as it was.
 */
import { replayTool, agentConfigRow, thesisRow, REPLAY_ACCOUNT_ID, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";
import { NEW_STOCKS_A_RUN } from "@/lib/agent/portfolio-manager/limits";

const CATALYST = "cmmmh0wxu000004js7yoyzvlf";
const SECULAR = "cmmqxola3000004lbj7c11bfn";
const PEAD = "cmnhxpjio000004jvox6kl6c7";
const PM_RUN = "pm_run_2026_11_23";

const pmRun = { id: PM_RUN, accountId: REPLAY_ACCOUNT_ID, status: "RUNNING", mode: "PORTFOLIO_MANAGER", agentConfigId: null, parameters: {}, startedAt: new Date("2026-11-23T15:30:00Z"), completedAt: null };
const ANALYSTS = [
  agentConfigRow({ id: CATALYST, name: "Catalyst Event PM", tradingEnvironment: "LIVE", createdAt: new Date("2026-03-11") }),
  agentConfigRow({ id: "cmmofy6t3000004l7858o1xma", name: "Momentum Breakout", tradingEnvironment: "PAPER", enabled: false, createdAt: new Date("2026-03-12") }),
  agentConfigRow({ id: SECULAR, name: "Secular Compounder", tradingEnvironment: "LIVE", createdAt: new Date("2026-03-14") }),
  agentConfigRow({ id: PEAD, name: "PEAD Specialist", tradingEnvironment: "LIVE", createdAt: new Date("2026-04-02") }),
  agentConfigRow({ id: "cmwmilkk6000008l70nuo6iq8", name: "Quality Leaders", tradingEnvironment: "PAPER", createdAt: new Date("2026-11-19") }),
];
const BRIEF = "Costco: the account holds no consumer staples, and its November sales report beat. A steady compounder to watch for a pullback to the 50-day average.";

const send = async (args: Record<string, unknown>, over: { runs?: Row[]; theses?: Row[]; ctx?: Record<string, unknown> } = {}) => {
  const events: Array<{ data: Record<string, unknown> }> = [];
  const r = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
    seed: { agentConfig: ANALYSTS, researchRun: [pmRun, ...(over.runs ?? [])], thesis: over.theses ?? [] },
    args: { ticker: "COST", brief: BRIEF, ...args },
    ctx: { runId: PM_RUN, runMode: "PORTFOLIO_MANAGER", analystId: undefined, runEnvironment: "LIVE", ...over.ctx },
    mocks: {
      "@/lib/market-data/sec-filings": () => ({ fetchBookFilings: async () => ({ byTicker: new Map() }) }),
      "@/lib/inngest/client": () => ({ inngest: { createFunction: () => ({}), send: async (e: { data: Record<string, unknown> }) => void events.push(e) } }),
    },
  });
  const writers = r.db.store.researchRun.filter((x) => x.mode === "THESIS_WRITER" && !(over.runs ?? []).some((seeded) => seeded.id === x.id));
  return { r, events, writer: writers[0] };
};

describe("the Portfolio Manager's send on a stock no analyst holds or watches", () => {
  it("naming the analyst as the stock table shows it, a Writer starts for that analyst with the brief to write on the new watch", async () => {
    const { r, events, writer } = await send({ analyst_id: "Secular Compounder" });
    expect(r.crashed).toBe(false);
    expect(writer).toMatchObject({ agentConfigId: SECULAR, parentRunId: PM_RUN, environment: "LIVE" });
    expect(writer.parameters).toMatchObject({ ticker: "COST", mode: "mint", existingThesisId: null, reason: BRIEF });
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ ticker: "COST", analystId: SECULAR, mode: "mint", forceWatchingMint: true, sentBrief: BRIEF, parentRunId: PM_RUN });
  });

  it("naming no analyst, it is refused with this book's analysts that are on, by name, and no Writer starts", async () => {
    const { r, writer } = await send({});
    expect(r.result.summary).toBe(
      "Dispatch refused for $COST: No analyst holds or watches $COST. To start a watch on it, send it again with the analyst it is for in analyst_id: Catalyst Event PM, Secular Compounder, PEAD Specialist.",
    );
    expect(writer).toBeUndefined();
  });

  it("a paper analyst, or a paused one, is not this book's to name", async () => {
    for (const analyst_id of ["Quality Leaders", "Momentum Breakout"]) {
      const { r, writer } = await send({ analyst_id });
      expect(r.result.summary).toMatch(/^Dispatch refused for \$COST: No analyst holds or watches \$COST\. To start a watch on it/);
      expect(writer).toBeUndefined();
    }
  });

  it(`after ${NEW_STOCKS_A_RUN} new stock this run, the next is refused in a sentence, and a refresh still goes through`, async () => {
    const sentCost = { id: "writer_cost", accountId: REPLAY_ACCOUNT_ID, status: "RUNNING", mode: "THESIS_WRITER", agentConfigId: SECULAR, parentRunId: PM_RUN, parameters: { ticker: "COST", mode: "mint" }, startedAt: new Date("2026-11-23T15:34:00Z"), completedAt: null };
    const second = await send({ ticker: "PG", analyst_id: "Secular Compounder" }, { runs: [sentCost] });
    expect(second.r.result.summary).toBe(
      'Dispatch refused for $PG: You have sent your 1 new stock to research for this run (COST). Name $PG under "What the account needs" in your write-up.',
    );
    expect(second.writer).toBeUndefined();

    const held = thesisRow({ id: "nvda_hold", ticker: "NVDA", status: "HOLDING", direction: "LONG", analystId: SECULAR } as Partial<Row>);
    const refresh = await send({ ticker: "NVDA" }, { runs: [sentCost], theses: [held] });
    expect(refresh.writer).toMatchObject({ agentConfigId: SECULAR });
    expect(refresh.writer.parameters).toMatchObject({ mode: "refresh", existingThesisId: "nvda_hold" });
    expect(refresh.events[0].data).not.toHaveProperty("sentBrief");
  });

  it("a new stock sent by another Portfolio Manager run doesn't count against this one", async () => {
    const earlier = { id: "writer_earlier", accountId: REPLAY_ACCOUNT_ID, status: "COMPLETE", mode: "THESIS_WRITER", agentConfigId: SECULAR, parentRunId: "pm_run_2026_11_19", parameters: { ticker: "PG", mode: "mint" }, startedAt: new Date("2026-11-19T15:34:00Z"), completedAt: new Date("2026-11-19T15:39:00Z") };
    const { writer } = await send({ analyst_id: SECULAR }, { runs: [earlier] });
    expect(writer).toMatchObject({ agentConfigId: SECULAR });
  });
});

describe("any other run's send is as it was", () => {
  it("a morning run sends a new stock for its own analyst: no analyst to name, no limit, no brief on the event", async () => {
    const mine = agentConfigRow({ tradingEnvironment: "LIVE" });
    const events: Array<{ data: Record<string, unknown> }> = [];
    const r = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [mine], researchRun: [{ ...pmRun, id: "morning", mode: "MORNING_PLAN", agentConfigId: REPLAY_ANALYST_ID }, { id: "w1", accountId: REPLAY_ACCOUNT_ID, status: "COMPLETE", mode: "THESIS_WRITER", agentConfigId: REPLAY_ANALYST_ID, parentRunId: "morning", parameters: { ticker: "PG", mode: "mint" }, startedAt: new Date("2026-11-23T10:00:00Z"), completedAt: new Date("2026-11-23T10:05:00Z") }], thesis: [] },
      args: { ticker: "COST", brief: BRIEF },
      ctx: { runId: "morning", runMode: "MORNING_PLAN", runEnvironment: "LIVE" },
      mocks: {
        "@/lib/market-data/sec-filings": () => ({ fetchBookFilings: async () => ({ byTicker: new Map() }) }),
        "@/lib/inngest/client": () => ({ inngest: { createFunction: () => ({}), send: async (e: { data: Record<string, unknown> }) => void events.push(e) } }),
      },
    });
    expect(r.db.store.researchRun.find((x) => x.mode === "THESIS_WRITER" && x.id !== "w1")).toMatchObject({ agentConfigId: REPLAY_ANALYST_ID, parentRunId: "morning" });
    expect(events[0].data).toMatchObject({ ticker: "COST", mode: "mint" });
    expect(events[0].data).not.toHaveProperty("sentBrief");
  });
});
