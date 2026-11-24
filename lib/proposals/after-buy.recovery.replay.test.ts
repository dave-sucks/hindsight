/**
 * A filled buy whose After the buy failed, on KEYS's real fill.
 *
 * KEYS (PEAD Specialist, LIVE), 2026-11-23: 28 shares filled at $289.6286 at
 * 3:58 PM ET (order cmwtqwl1r001d08jvgagirprf). The database connection the
 * run drew was read-only, so both tries failed before a run row existed, the
 * holding had only its floor, and nothing asked again or said so.
 * Only the database, the agent runner and the email are doubled.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_USER_ID, REPLAY_ACCOUNT_ID, type PrismaDouble, type Row } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

let db: PrismaDouble;
let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
let onFailure: ((ctx: unknown) => Promise<unknown>) | undefined;
const mockRunAgentAsRun = jest.fn();
const mockEmail = jest.fn(async (_args: { subject: string; body: string }) => true);
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
jest.mock("@/lib/inngest/client", () => ({
  inngest: {
    createFunction: (c: { onFailure?: typeof onFailure }, _t: unknown, fn: typeof handler) => ((onFailure = c.onFailure), (handler = fn), {}),
    send: async () => undefined,
  },
}));
jest.mock("@/lib/emails/run-lost", () => ({ sendRunLostEmail: (a: { subject: string; body: string }) => mockEmail(a) }));
jest.mock("@/lib/agent/engine/run", () => ({ runAgentAsRun: (...a: unknown[]) => mockRunAgentAsRun(...a) }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => undefined }));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: async () => null }));
jest.mock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: async () => [] }));

import { BUY_FILLED, buyLeft, tellBuy } from "./after-buy";
import { runAfterBuy } from "@/lib/inngest/functions/after-buy-run";

const ANALYST = "cmnhxpjio000004jvox6kl6c7";
const THESIS = "cmwocoypj001108lj8o7pngyo";
const POSITION = "cmwtqwl17001c08jvumgnma1g";
const ORDER = "cmwtqwl1r001d08jvgagirprf";
const FILLED = new Date("2026-11-23T20:58:14Z");
const FLOOR: Trigger = { id: "keys-floor", action: "EXIT", source: "PRINCIPAL", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 272.25 }, rationale: "You set this." } as Trigger;
const READ_ONLY = "cannot execute INSERT in a read-only transaction";

const run = (id: string, status: string) => ({ id, mode: "AFTER_BUY", status, startedAt: FILLED, accountId: REPLAY_ACCOUNT_ID, parameters: { ticker: "KEYS", thesisId: THESIS, orderId: ORDER } });

function keys(rows: { researchRun?: Row[]; thesisUpdate?: Row[] } = {}, thesis: Partial<Row> = {}) {
  db = prismaDouble({
    account: [accountRow({})],
    agentConfig: [agentConfigRow({ id: ANALYST, name: "PEAD Specialist", tradingEnvironment: "LIVE" } as Partial<Row>)],
    thesis: [thesisRow({ id: THESIS, ticker: "KEYS", status: "HOLDING", direction: "LONG", analystId: ANALYST, triggers: [FLOOR], ...thesis } as Partial<Row>)],
    position: [positionRow({ id: POSITION, analystId: ANALYST, symbol: "KEYS", status: "OPEN", environment: "LIVE", quantity: 28, avgCost: 289.6286 } as Partial<Row>)],
    order: [{ id: ORDER, positionId: POSITION, userId: REPLAY_USER_ID, environment: "LIVE", symbol: "KEYS", side: "BUY", orderType: "MARKET", quantity: 28, status: "FILLED", intent: "OPEN", filledPrice: 289.6286, filledQty: 28, filledAt: FILLED, thesisId: THESIS, triggerIds: [], rationale: null, position: { analystId: ANALYST, avgCost: 289.6286, quantity: 28 }, decision: null }],
    thesisUpdate: rows.thesisUpdate ?? [],
    researchRun: rows.researchRun ?? [],
  });
}

const step = () => {
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];
  return {
    events,
    run: async <T,>(_id: string, fn: () => Promise<T>) => fn(),
    sleep: async () => undefined,
    sendEvent: async (_id: string, e: { name: string; data: Record<string, unknown> }) => void events.push(e),
  };
};

beforeEach(() => {
  mockEmail.mockClear();
  mockRunAgentAsRun.mockReset();
});

describe("After the buy fails, on KEYS's fill", () => {
  it("what happened on Nov 23: the run can't start, the function fails, and the failure handler sends the fill again", async () => {
    keys();
    mockRunAgentAsRun.mockRejectedValue(new Error(READ_ONLY));
    const s = step();
    await expect(handler!({ event: { data: { orderId: ORDER } }, step: s })).rejects.toThrow(READ_ONLY);
    await onFailure!({ event: { data: { event: { name: BUY_FILLED, data: { orderId: ORDER }, ts: FILLED.getTime() + 60_000 } } }, step: s });
    expect(s.events).toEqual([{ name: BUY_FILLED, data: { orderId: ORDER, recoveryTry: 1, firstTriedAt: new Date(FILLED.getTime() + 60_000).toISOString() } }]);
  });

  it("a run that ends failed fails the function, so it is tried again", async () => {
    keys();
    mockRunAgentAsRun.mockResolvedValue({ runId: "run_failed", status: "FAILED" });
    await expect(handler!({ event: { data: { orderId: ORDER } }, step: step() })).rejects.toThrow("After the buy run run_failed failed");
  });

  it("the try again runs: a failed run that wrote nothing is not done", async () => {
    keys({ researchRun: [run("run_failed", "FAILED")] });
    expect(await buyLeft({ orderId: ORDER })).toBe("retry");
    mockRunAgentAsRun.mockResolvedValue({ runId: "run_retry", status: "COMPLETE" });
    expect(await runAfterBuy(ORDER)).toEqual({ runId: "run_retry", status: "COMPLETE", noted: false });
  });

  it("a run that put triggers on and then failed did its work: no second run, no email", async () => {
    keys({ researchRun: [run("run_capped", "FAILED")], thesisUpdate: [{ id: "u1", thesisId: THESIS, runId: "run_capped", type: "UPDATED", timestamp: FILLED }] });
    expect(await buyLeft({ orderId: ORDER })).toBe("done");
    expect(await runAfterBuy(ORDER)).toEqual({ skipped: "already run (run_capped)" });
  });

  it("a finished run is done, and so is a stock no longer held", async () => {
    keys({ researchRun: [run("run_ok", "COMPLETE")] });
    expect(await buyLeft({ orderId: ORDER })).toBe("done");
    keys({}, { status: "RETIRED" });
    expect(await buyLeft({ orderId: ORDER })).toBe("done");
  });

  it("the email names the stock and the floor it still has", async () => {
    keys();
    await tellBuy({ orderId: ORDER });
    expect(mockEmail.mock.calls[0][0].subject).toBe("KEYS: After the buy didn't run");
    expect(mockEmail.mock.calls[0][0].body).toContain('It still has "Sell if below $272.25"');
  });
});
