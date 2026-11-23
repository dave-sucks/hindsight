/**
 * A sale waiting for the principal's approval silences that sale and nothing
 * else on the stock (the owner's ruling, 2026-11-16; before it a waiting sale
 * took the whole stock off the work list, sale-card-note.replay.test.ts).
 *
 * On 2026-10-15 both morning runs worked a stock whose sale was waiting: NVDA
 * for stale research (a flag deleted since, so NVDA is only the card now: a
 * quiet line that says the sale waits), CEG for its "below the 200-day"
 * review, which fired after the sale did: the review is CEG's work, the sale
 * is not, and the row says the sale waits.
 *
 * The morning reads' own rows (sale-waiting-quiet-2026-10-15.json), through
 * get_theses' real entry point at the moment each run began.
 */
import type { StockTable } from "@/lib/agent/stock-table";
import { statSync } from "fs";
import fx from "@/lib/agent/__fixtures__/sale-waiting-quiet-2026-10-15.json";
import { replayTool, thesisRow, positionRow, thesisUpdateRow, agentConfigRow, REPLAY_ACCOUNT_ID, REPLAY_USER_ID, type Row } from "@/lib/replay";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { rowForModel } from "@/lib/agent/row-for-model";
import type { Trigger } from "@/lib/agent/triggers/types";

type Case = (typeof fx)["ceg"] & { analystTriggers?: Row[] };
const dated = (r: Row, keys: string[]) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) && typeof v === "string" ? new Date(v) : v]));

function seed(c: Case, ticker: string): Record<string, Row[]> {
  const id = c.thesis.id;
  return {
    agentConfig: [agentConfigRow({ id: c.run.analystId, triggers: c.analystTriggers ?? [] })],
    thesis: [thesisRow({ ...dated(c.thesis, ["createdAt", "lastReviewedAt", "researchUpdatedAt"]), analystId: c.run.analystId })],
    position: [positionRow({ ...dated(c.position, ["openedAt"]), analystId: c.run.analystId, symbol: ticker, environment: "LIVE" })],
    order: [{ ...dated(c.order, ["createdAt", "expiresAt"]), userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, environment: "LIVE", symbol: ticker, orderType: "MARKET", rejectionMessage: null, thesisId: id }],
    thesisUpdate: c.activity.map((u) => thesisUpdateRow({ ...dated(u, ["timestamp"]), thesisId: id })),
  };
}

async function morningRead(c: Case, ticker: string) {
  jest.useFakeTimers({
    now: new Date(c.run.startedAt),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    const { result, crashed } = await replayTool("get-theses", "getTheses", {
      seed: seed(c, ticker),
      args: { detail: "actionable" },
      ctx: { runId: c.run.id, analystId: c.run.analystId, runEnvironment: "LIVE" },
      quotes: { [ticker]: c.price },
    });
    if (crashed) throw new Error(`get_theses crashed: ${JSON.stringify(result).slice(0, 2000)}`);
    const screen = result.data as { theses?: Row[]; quiet_theses?: Row[] };
    const quiet = screen.quiet_theses?.find((r) => r.ticker === ticker) ?? null;
    const row = screen.theses?.find((r) => r.ticker === ticker) ?? null;
    return {
      row,
      // A quiet stock's line of the stock table says what waits for the owner.
      line: quiet ? ((result.data as { stocks?: StockTable }).stocks?.rows.find((r) => r.ticker === ticker)?.waiting ?? "") : null,
      waits: row ? ((rowForModel(row) as Row).proposal_waiting as string | undefined) : undefined,
    };
  } finally {
    jest.useRealTimers();
  }
}

const SALE_WAITS = {
  NVDA: "sell 33 sh, placed 10-14 14:01 ET, expires 10-15 14:01 ET",
  CEG: "sell 51 sh, placed 10-14 09:45 ET, expires 10-15 09:45 ET",
};

describe("NVDA at the 10-15 morning run, its sale waiting", () => {
  const c = fx.nvda as unknown as Case;

  it("the seed is the read's: each trigger says what the read showed, and the read worked the stock", () => {
    expect(c.thesis.triggers.map((t) => sentenceOf(t as Trigger))).toEqual(c.says);
    expect(c.read.needsAction.kind).toBe("RESEARCH_STALE");
  });

  it("is a quiet line: stale research is no situation now, and the sale is the card's; the line says the sale waits", async () => {
    const { row, line } = await morningRead(c, "NVDA");
    expect(row).toBeNull();
    expect(line).toMatch(/^sell \d+$/);
    expect(SALE_WAITS.NVDA.startsWith(`${line} sh`)).toBe(true);
  });
});

describe("CEG at the 10-15 morning run, its sale waiting and its 200-day review fired", () => {
  const c = fx.ceg as unknown as Case;

  it("the seed is the read's: each trigger says what the read showed, and the read worked the stock", () => {
    expect(c.thesis.triggers.map((t) => sentenceOf(t as Trigger))).toEqual(c.says);
    expect(c.read.needsAction.kind).toBe("TRIGGER_FIRED");
    expect(c.read.situations).toEqual(["REVIEW_DUE"]);
  });

  it("is listed for the review, as the run's read was, and not for the sale; the row says the sale waits", async () => {
    const { row, line, waits } = await morningRead(c, "CEG");
    expect(line).toBeNull();
    expect(row?.situations).toEqual(c.read.situations);
    expect(row?.needsAction).toMatchObject({ kind: "TRIGGER_FIRED", action: "REVIEW", triggerId: c.read.needsAction.triggerId });
    expect(waits).toBe(SALE_WAITS.CEG);
  });
});

it("the fixture holds only the fields the read uses, under the cap", () => {
  expect(statSync("lib/agent/__fixtures__/sale-waiting-quiet-2026-10-15.json").size).toBeLessThan(10 * 1024);
});
