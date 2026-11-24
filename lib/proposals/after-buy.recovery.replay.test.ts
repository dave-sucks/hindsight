/**
 * A filled buy whose After the buy never finished, on KEYS's real fill.
 *
 * KEYS (PEAD Specialist, LIVE), 2026-11-23: 28 shares filled at $289.6286 at
 * 3:58 PM ET (order cmwtqwl1r001d08jvgagirprf). The database connection the
 * run drew was read-only, so both tries failed before a run row existed, the
 * holding had only its floor, and nothing asked again or said so.
 * Only the database, the agent runner, the email and the event send are doubled.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_USER_ID, REPLAY_ACCOUNT_ID, type PrismaDouble, type Row } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

let db: PrismaDouble;
const mockSend = jest.fn(async (_event: unknown) => undefined);
const mockRunAgentAsRun = jest.fn();
const mockEmail = jest.fn(async (_args: { subject: string; body: string }) => true);
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: (e: unknown) => mockSend(e as never) } }));
jest.mock("@/lib/emails/run-lost", () => ({ sendRunLostEmail: (a: { subject: string; body: string }) => mockEmail(a) }));
jest.mock("@/lib/agent/engine/run", () => ({ runAgentAsRun: (...a: unknown[]) => mockRunAgentAsRun(...a) }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => undefined }));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: async () => null }));
jest.mock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: async () => [] }));

import { BUY_FILLED, sweepAfterBuys } from "./after-buy";
import { runAfterBuy } from "@/lib/inngest/functions/after-buy-run";

const ANALYST = "cmnhxpjio000004jvox6kl6c7";
const THESIS = "cmwocoypj001108lj8o7pngyo";
const POSITION = "cmwtqwl17001c08jvumgnma1g";
const ORDER = "cmwtqwl1r001d08jvgagirprf";
const FILLED = new Date("2026-11-23T20:58:14Z");
const after = (minutes: number) => new Date(FILLED.getTime() + minutes * 60_000);
const FLOOR: Trigger = { id: "keys-floor", action: "EXIT", source: "PRINCIPAL", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 272.25 }, rationale: "You set this." } as Trigger;

const run = (status: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  id: `run_${status}_${minutes}`,
  mode: "AFTER_BUY",
  status,
  startedAt: after(minutes),
  accountId: REPLAY_ACCOUNT_ID,
  parameters: { ticker: "KEYS", thesisId: THESIS, orderId: ORDER, ...extra },
});

function keys(runs: Row[] = [], thesis: Partial<Row> = {}) {
  db = prismaDouble({
    account: [accountRow({})],
    agentConfig: [agentConfigRow({ id: ANALYST, name: "PEAD Specialist", tradingEnvironment: "LIVE" } as Partial<Row>)],
    thesis: [thesisRow({ id: THESIS, ticker: "KEYS", status: "HOLDING", direction: "LONG", analystId: ANALYST, triggers: [FLOOR], ...thesis } as Partial<Row>)],
    position: [positionRow({ id: POSITION, analystId: ANALYST, symbol: "KEYS", status: "OPEN", environment: "LIVE", quantity: 28, avgCost: 289.6286 } as Partial<Row>)],
    order: [{ id: ORDER, positionId: POSITION, userId: REPLAY_USER_ID, environment: "LIVE", symbol: "KEYS", side: "BUY", orderType: "MARKET", quantity: 28, status: "FILLED", intent: "OPEN", filledPrice: 289.6286, filledQty: 28, filledAt: FILLED, thesisId: THESIS, triggerIds: [], rationale: null, position: { analystId: ANALYST, avgCost: 289.6286, quantity: 28 }, decision: null }],
    thesisUpdate: [],
    researchRun: runs,
  });
}

const asked = () => mockSend.mock.calls.map(([e]) => e as { name: string; data: { orderId: string } }).filter((e) => e.name === BUY_FILLED);

beforeEach(() => {
  mockSend.mockClear();
  mockEmail.mockClear();
  mockEmail.mockResolvedValue(true);
  mockRunAgentAsRun.mockReset();
});

describe("the sweep, on KEYS's fill", () => {
  it("asks again for a fill whose tries died before a run existed, what happened on Nov 23", async () => {
    keys();
    expect(await sweepAfterBuys(after(7))).toEqual({ sent: 1, told: 0 });
    expect(asked()).toEqual([{ name: BUY_FILLED, data: { orderId: ORDER } }]);
  });

  it("leaves a fill alone for its first five minutes", async () => {
    keys();
    expect(await sweepAfterBuys(after(2))).toEqual({ sent: 0, told: 0 });
  });

  it("asks again after a failed run, and stops at a finished one", async () => {
    keys([run("FAILED", 2)]);
    expect((await sweepAfterBuys(after(7))).sent).toBe(1);
    keys([run("FAILED", 2), run("COMPLETE", 8)]);
    mockSend.mockClear();
    expect(await sweepAfterBuys(after(12))).toEqual({ sent: 0, told: 0 });
  });

  it("waits for a run that is going, and counts one that died", async () => {
    keys([run("RUNNING", 2)]);
    expect((await sweepAfterBuys(after(7))).sent).toBe(0);
    keys([run("RUNNING", 2)]);
    expect((await sweepAfterBuys(after(30))).sent).toBe(1);
  });

  it("after three failed runs it emails the owner once, naming the stock and its floor, and runs no more", async () => {
    keys([run("FAILED", 2), run("FAILED", 7), run("FAILED", 12)]);
    expect(await sweepAfterBuys(after(17))).toEqual({ sent: 0, told: 1 });
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(mockEmail.mock.calls[0][0].subject).toBe("KEYS: After the buy didn't run");
    expect(mockEmail.mock.calls[0][0].body).toContain('It still has "Sell if below $272.25"');
    expect(await runAfterBuy(ORDER)).toEqual({ skipped: "a run is going, or its tries are used" });
    expect(await sweepAfterBuys(after(22))).toEqual({ sent: 0, told: 0 });
    expect(mockEmail).toHaveBeenCalledTimes(1);
  });

  it("tells the owner when no run has finished two hours after the fill", async () => {
    keys();
    expect(await sweepAfterBuys(after(121))).toEqual({ sent: 0, told: 1 });
  });

  it("tries the email again when it didn't send", async () => {
    keys([run("FAILED", 2), run("FAILED", 7), run("FAILED", 12)]);
    mockEmail.mockResolvedValueOnce(false);
    expect((await sweepAfterBuys(after(17))).told).toBe(0);
    expect((await sweepAfterBuys(after(22))).told).toBe(1);
  });

  it("owes nothing on a stock no longer held", async () => {
    keys([], { status: "RETIRED" });
    expect(await sweepAfterBuys(after(7))).toEqual({ sent: 0, told: 0 });
    expect(mockEmail).not.toHaveBeenCalled();
  });
});

describe("runAfterBuy, after a failure", () => {
  it("runs again after a failed run: a failed run no longer counts as done", async () => {
    keys([run("FAILED", 2)]);
    mockRunAgentAsRun.mockResolvedValue({ runId: "run_retry", status: "COMPLETE" });
    expect(await runAfterBuy(ORDER)).toEqual({ runId: "run_retry", status: "COMPLETE", noted: false });
  });

  it("still runs a late fill the owner was already told about", async () => {
    keys([run("FAILED", 121, { ownerTold: true })]);
    mockRunAgentAsRun.mockResolvedValue({ runId: "run_late", status: "COMPLETE" });
    expect(await runAfterBuy(ORDER)).toMatchObject({ runId: "run_late" });
  });
});
