/**
 * A sale waiting for the principal's approval takes the stock off the work
 * list entirely, not only the sale. On 2026-10-15 both morning runs still
 * worked a stock whose sale was waiting: NVDA for stale research, CEG for its
 * "below the 200-day" review. The principal decides those stocks now; the
 * read gives each one quiet line, which says the sale waits.
 *
 * The morning reads' own rows (sale-waiting-quiet-2026-10-15.json), through
 * get_theses' real entry point at the moment each run began.
 */
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
    return { row: screen.theses?.find((r) => r.ticker === ticker) ?? null, line: quiet ? (rowForModel(quiet, { named: false, size: "line" }) as string) : null };
  } finally {
    jest.useRealTimers();
  }
}

describe.each([
  ["NVDA", fx.nvda as unknown as Case, "sell 33 sh, placed 10-14 14:01 ET, expires 10-15 14:01 ET"],
  ["CEG", fx.ceg as unknown as Case, "sell 51 sh, placed 10-14 09:45 ET, expires 10-15 09:45 ET"],
])("%s at the 10-15 morning run, its sale waiting", (ticker, c, waits) => {
  it("the seed is the read's: each trigger says what the read showed, and the read worked the stock", () => {
    expect(c.thesis.triggers.map((t) => sentenceOf(t as Trigger, true))).toEqual(c.says);
    expect(c.read.needsAction.kind).toBe(ticker === "NVDA" ? "RESEARCH_STALE" : "TRIGGER_FIRED");
  });

  it("is a quiet line with no work flag, and the line says the sale waits", async () => {
    const { row, line } = await morningRead(c, ticker);
    expect(row).toBeNull();
    expect(line).toContain(`proposal waiting: ${waits}`);
  });
});

it("the fixture holds only the fields the read uses, under the cap", () => {
  expect(statSync("lib/agent/__fixtures__/sale-waiting-quiet-2026-10-15.json").size).toBeLessThan(10 * 1024);
});
