/**
 * gev-hold-after-lapse.replay.test.ts — after a lapsed sale, the analyst's
 * call to hold stands (the owner's ruling, 2026-10-30).
 *
 * GEV, 2026-10-28 09:40 ET (Secular Compounder, trigger run
 * cmvs5wied000g07lhe4g9iz6j): the floor and the 6% give-back fired with two
 * sales lapsed that week. The analyst wrote a hold note; complete_run refused
 * it ("A review that changes nothing does not answer it"), so the run
 * proposed the sale and wrote a second note contradicting the first.
 *
 * Production rows, read-only, in gev-hold-after-lapse-2026-10-28.json, at
 * the moment of the first complete_run call. The sale trigger still asks
 * every day the price is past the line; only the close-out's bar is gone.
 */
import { statSync } from "fs";
import fixture from "@/lib/agent/__fixtures__/gev-hold-after-lapse-2026-10-28.json";
import { replayTool, thesisRow, positionRow, thesisUpdateRow, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID, REPLAY_ANALYST_ID, REPLAY_USER_ID, type Row } from "@/lib/replay";

const FIXTURE = "lib/agent/__fixtures__/gev-hold-after-lapse-2026-10-28.json";
type Dated = Row & { id: string };
const fx = fixture as unknown as {
  at: string;
  price: number;
  run: { id: string; mode: string; startedAt: string; parameters: Row };
  refusedWith: string;
  thesis: Dated & { triggers: Row[] };
  position: Dated;
  orders: Dated[];
  activity: Dated[];
  runRows: Dated[];
  analystTriggers: Row[];
  accountTriggers: Row[];
  accountTriggersSeededAt: string;
};

const dated = (r: Row, keys: string[]) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) && typeof v === "string" ? new Date(v) : v]));
const TH = fx.thesis.id;

function seed(runRows: Dated[]): Record<string, Row[]> {
  return {
    agentConfig: [agentConfigRow({ triggers: fx.analystTriggers })],
    account: [accountRow({ triggers: fx.accountTriggers, triggersSeededAt: new Date(fx.accountTriggersSeededAt) })],
    thesis: [thesisRow(dated(fx.thesis, ["createdAt", "lastReviewedAt", "researchUpdatedAt", "catalystDate"]))],
    position: [positionRow({ ...dated(fx.position, ["openedAt"]), symbol: "GEV", environment: "LIVE" })],
    order: fx.orders.map((o) => ({ userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, orderType: "MARKET", rejectionMessage: null, thesisId: TH, ...dated(o, ["createdAt", "expiresAt", "updatedAt"]) })),
    thesisUpdate: [...fx.activity, ...runRows].map((u) => thesisUpdateRow({ ...dated(u, ["timestamp"]), thesisId: TH })),
    researchRun: [{ id: fx.run.id, status: "RUNNING", mode: fx.run.mode, agentConfigId: REPLAY_ANALYST_ID, parameters: fx.run.parameters, startedAt: new Date(fx.run.startedAt), completedAt: null }],
  };
}

/** complete_run at the production moment; the double's timers stay real. */
async function completeRun(runRows: Dated[]) {
  jest.useFakeTimers({
    now: new Date(fx.at),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    return await replayTool("complete-run", "completeRun", {
      seed: seed(runRows),
      args: {},
      ctx: { runId: fx.run.id, runMode: "INTRADAY_TACTICAL", runEnvironment: "LIVE" },
      quotes: { GEV: fx.price },
    });
  } finally {
    jest.useRealTimers();
  }
}

describe("GEV 10-28 09:40 ET: the hold note after two lapsed sales", () => {
  it("the rows as they stood: two lapses, the 10-27 sale past its expiry, and the run's one note", () => {
    expect(fx.orders.map((o) => o.status)).toEqual(["EXPIRED", "EXPIRED", "AWAITING_APPROVAL"]);
    expect(fx.runRows.map((u) => u.type)).toEqual(["TRIGGER_FIRED", "TRIGGER_FIRED", "REVIEWED"]);
  });

  it("complete_run accepts the run: the note answers the lapsed sale", async () => {
    const { result, db, crashed } = await completeRun(fx.runRows);
    expect(crashed).toBe(false);
    expect(result.summary).not.toMatch(/refused/i);
    expect(db.store.researchRun[0].status).toBe("COMPLETE");
  });

  it("without the note, it still refuses with the line production wrote, now saying a hold answers it", async () => {
    const { result, crashed } = await completeRun(fx.runRows.filter((u) => u.type !== "REVIEWED"));
    expect(crashed).toBe(false);
    expect(result.summary).toMatch(/refused/i);
    const text = JSON.stringify(result);
    // The replay serves no daily bars, so the recent low ($796.41 that morning) is absent here.
    expect(text).toContain(fx.refusedWith.split(" Recent low")[0]);
    expect(text).toContain("Answer it: propose the sale again with today's reasons, or say why you hold; it asks again tomorrow while the price is past the line.");
    expect(text).not.toContain("does not answer it");
  });
});

it("the fixture holds only the fields complete_run reads, with no free text, under the cap", () => {
  expect(statSync(FIXTURE).size).toBeLessThan(20 * 1024);
  for (const t of [...fx.thesis.triggers, ...fx.analystTriggers, ...fx.accountTriggers]) expect(t.rationale).toBe("(not kept)");
  for (const u of [...fx.activity, ...fx.runRows]) expect(u).not.toHaveProperty("rationale");
});
