/**
 * The morning read lists a review on the price only through its crossing's fire row, never as "true now".
 *
 * MU, Wednesday 2026-11-04 at 8:00 ET, the morning read (get_theses) with MU at Tuesday's $855.10 close,
 * under its "Review if below $878". With reviews firing on the crossing, its last fire is the Nov 2
 * crossing, so its one-day rest is over. The read has no prior close and can't see a crossing; before
 * this, it listed the review as true now every morning MU stayed under $878. Rows in
 * lib/agent/__fixtures__/review-crossing-2026-11.json (the review, MU's Nov 2 Activity, the closes).
 */
import raw from "@/lib/agent/__fixtures__/review-crossing-2026-11.json";
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";

type Row = Record<string, unknown> & { id: string; timestamp: string; runId: string | null; runMode: string | null };
const fx = raw as unknown as {
  mu: {
    thesis: Record<string, unknown> & { id: string; createdAt: string };
    analyst: { id: string; name: string };
    position: { avgCost: number; openedAt: string };
    review: Record<string, unknown> & { id: string };
    closes: Record<string, number>;
    nov2: { rows: Row[] };
  };
};
const [MORNING_LINE, CROSSING_FIRE, TRIGGER_RUN_LINE] = fx.mu.nov2.rows;
const WEDNESDAY_8AM = new Date("2026-11-04T13:00:00Z");
const FAKE = ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] as const;

/** MU in the morning read, with these Activity rows. */
async function morningRead(rows: Row[]) {
  const review = { ...fx.mu.review, lastFiredAt: CROSSING_FIRE.timestamp };
  const lastAnswer = rows.filter((r) => r.runId).at(-1)!;
  jest.useFakeTimers({ now: WEDNESDAY_8AM, doNotFake: [...FAKE] });
  try {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [
          thesisRow({
            ...fx.mu.thesis,
            createdAt: new Date(fx.mu.thesis.createdAt),
            lastReviewedAt: new Date(lastAnswer.timestamp),
            triggers: [review],
            researchRun: { agentConfigId: fx.mu.analyst.id, agentConfig: { name: fx.mu.analyst.name, setupIds: [], enabled: true } },
          }),
        ],
        position: [positionRow({ analystId: fx.mu.analyst.id, symbol: "MU", avgCost: fx.mu.position.avgCost, peakPrice: fx.mu.position.avgCost, openedAt: new Date(fx.mu.position.openedAt) })],
        agentConfig: [agentConfigRow({ id: fx.mu.analyst.id, accountId: REPLAY_ACCOUNT_ID, triggers: [], enabled: true })],
        account: [accountRow({ triggers: [], triggersSeededAt: new Date("2026-09-01T00:00:00Z") })],
        researchRun: rows.filter((r) => r.runId).map((r) => ({ id: r.runId, mode: r.runMode, status: "COMPLETE", createdAt: new Date(r.timestamp), agentConfigId: fx.mu.analyst.id })),
        thesisUpdate: rows.map(({ runMode: _m, ...r }) => ({ ...r, thesisId: fx.mu.thesis.id, timestamp: new Date(r.timestamp) })),
      },
      args: {},
      ctx: { analystId: fx.mu.analyst.id, runMode: "MORNING_PLAN" },
      quotes: { MU: fx.mu.closes["2026-11-03"] },
    });
    const data = result.data as { theses?: Array<Record<string, unknown>>; quiet_theses?: Array<Record<string, unknown>> };
    const row = [...(data.theses ?? []), ...(data.quiet_theses ?? [])].find((r) => JSON.stringify(r).includes(fx.mu.thesis.id));
    expect(row).toBeDefined();
    return { listed: (data.theses ?? []).some((r) => r === row), situations: (row?.situations as string[] | undefined) ?? [] };
  } finally {
    jest.useRealTimers();
  }
}

describe("MU, Wednesday 2026-11-04, 8:00 ET — the morning read", () => {
  it("with the Nov 2 fire answered by a run's line, MU under $878 isn't on the list for the review (on main: listed as true now)", async () => {
    expect(await morningRead([MORNING_LINE, CROSSING_FIRE, TRIGGER_RUN_LINE])).toEqual({ listed: false, situations: [] });
  });

  it("with the Nov 2 crossing's fire unanswered, the review is on the list through its fire row", async () => {
    expect(await morningRead([MORNING_LINE, CROSSING_FIRE])).toEqual({ listed: true, situations: ["REVIEW_DUE"] });
  });
});
