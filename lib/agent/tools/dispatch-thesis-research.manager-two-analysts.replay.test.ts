/**
 * The Portfolio Manager has no analyst of its own: its send to the Writer
 * goes to the analyst whose live thesis the stock is. CRWD is watched by two:
 * the PEAD Specialist's watch with no view yet (2026-08-30) and the Secular
 * Compounder's LONG watch (2026-10-02, a compounder). The send used to take
 * the newest live thesis on the ticker, across analysts and by user, so the
 * PM's 11-19 ranking of CRWD would have refreshed the Secular Compounder's
 * thesis whichever one it meant. Now it names the analyst when two have one,
 * or is refused with them listed; the lookup reads this account.
 */
import { replayTool, agentConfigRow, thesisRow, REPLAY_ACCOUNT_ID, type Row } from "@/lib/replay";

const PEAD = "cmnhxpjio000004jvox6kl6c7";
const SECULAR = "cmmqxola3000004lbj7c11bfn";
const PM_RUN = "cmwnoggu8000m08js1rwgje05";
const PEAD_WATCH = "cmtg9zgpt000f04jp78g77xsc";
const SECULAR_WATCH = "cmurgwknr000404jtnef2nzwv";

const pmRun = { id: PM_RUN, accountId: REPLAY_ACCOUNT_ID, status: "RUNNING", mode: "PORTFOLIO_MANAGER", agentConfigId: null, parameters: {}, startedAt: new Date("2026-11-19T15:00:46Z"), completedAt: null };
const ANALYSTS = [agentConfigRow({ id: PEAD, name: "PEAD Specialist", tradingEnvironment: "LIVE" }), agentConfigRow({ id: SECULAR, name: "Secular Compounder", tradingEnvironment: "LIVE" })];
const CRWD = [
  thesisRow({ id: PEAD_WATCH, ticker: "CRWD", status: "WATCHING", direction: null, setupId: null, analystId: PEAD, createdAt: new Date("2026-08-30T20:42:07Z") } as Partial<Row>),
  thesisRow({ id: SECULAR_WATCH, ticker: "CRWD", status: "WATCHING", direction: "LONG", setupId: "COMPOUNDER_ACCUMULATION", analystId: SECULAR, createdAt: new Date("2026-10-02T21:21:00Z") } as Partial<Row>),
];
const noEdgar = { "@/lib/market-data/sec-filings": () => ({ fetchBookFilings: async () => ({ byTicker: new Map() }) }) };
const BRIEF = "CrowdStrike ranks second on the book after Palo Alto's report; refresh the thesis before its Dec 1 report.";

const send = (args: Record<string, unknown>, theses: Row[] = CRWD) =>
  replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
    seed: { agentConfig: ANALYSTS, researchRun: [pmRun], thesis: theses },
    args: { ticker: "CRWD", brief: BRIEF, ...args },
    ctx: { runId: PM_RUN, runMode: "PORTFOLIO_MANAGER", analystId: undefined, runEnvironment: "LIVE" },
    mocks: noEdgar,
  });
const writerOf = (r: Awaited<ReturnType<typeof send>>) => r.db.store.researchRun.find((x) => x.mode === "THESIS_WRITER");

describe("the Portfolio Manager's send on a stock two analysts watch (CRWD)", () => {
  it("naming no analyst, it is refused with both listed, and no Writer starts", async () => {
    const r = await send({});
    expect(r.crashed).toBe(false);
    expect(r.result.summary).toBe(
      `Dispatch refused for $CRWD: $CRWD is held or watched by 2 analysts: Secular Compounder (${SECULAR}), PEAD Specialist (${PEAD}). Send it again with the one whose thesis to refresh in analyst_id.`,
    );
    expect(writerOf(r)).toBeUndefined();
  });

  it("naming the PEAD Specialist, it refreshes that analyst's watch, not the newer one", async () => {
    const r = await send({ analyst_id: PEAD });
    expect(writerOf(r)).toMatchObject({ agentConfigId: PEAD, parentRunId: PM_RUN });
    expect(writerOf(r)!.parameters).toMatchObject({ mode: "refresh", existingThesisId: PEAD_WATCH });
  });

  it("naming an analyst who doesn't watch it, it is refused with the two who do", async () => {
    const r = await send({ analyst_id: "cmmmh0wxu000004js7yoyzvlf" });
    expect(r.result.summary).toMatch(/^Dispatch refused for \$CRWD: cmmmh0wxu000004js7yoyzvlf doesn't hold or watch \$CRWD\. The analysts who do: /);
    expect(writerOf(r)).toBeUndefined();
  });

  it("a stock one analyst watches needs no name", async () => {
    const r = await send({}, [CRWD[1]]);
    expect(writerOf(r)).toMatchObject({ agentConfigId: SECULAR });
    expect(writerOf(r)!.parameters).toMatchObject({ existingThesisId: SECULAR_WATCH });
  });

  it("a live thesis in another account is not this account's: it isn't counted", async () => {
    const elsewhere = thesisRow({ id: "other_acct_watch", ticker: "CRWD", status: "WATCHING", direction: "LONG", analystId: PEAD, accountId: "another-account" } as Partial<Row>);
    const r = await send({}, [CRWD[1], elsewhere]);
    expect(writerOf(r)).toMatchObject({ agentConfigId: SECULAR });
  });
});
