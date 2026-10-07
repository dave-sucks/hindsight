/**
 * get-theses.wake-date.replay.test.ts — "nothing can wake it" and the
 * report date.
 *
 * A watched stock with no plan whose only wake is the account's review
 * before earnings comes back only if the next report date is known. On
 * 2026-10-07 BBIO had none, and JBL's (09-30) and KMX's (09-29) were past:
 * the review was not yet real for any of them, so each keeps the flag, with
 * the reason in words, until a date is published.
 */
import { replayTool, thesisRow, agentConfigRow, accountRow } from "@/lib/replay";

const AT = new Date("2026-10-07T12:00:00Z");
const BEFORE_REPORT = {
  id: "acct_report",
  action: "REVIEW",
  source: "DEFAULT",
  predicate: { watch: "report", is: "before", value: 3 },
  rationale: "Reports within 3 days — decide before the print.",
  cooldownDays: 30,
};

async function readBbio(calendar: Array<Record<string, unknown>>) {
  jest.useFakeTimers({
    now: AT,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    return await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [thesisRow({ id: "t_bbio", ticker: "BBIO", status: "WATCHING", direction: "LONG", entryPrice: null, targetPrice: null, stopLoss: null, triggers: [] })],
        agentConfig: [agentConfigRow()],
        account: [accountRow({ triggers: [BEFORE_REPORT], triggersSeededAt: new Date("2026-09-01T00:00:00Z") })],
      },
      args: { tickers: ["BBIO"] },
      quotes: { BBIO: 55 },
      mocks: {
        "@/lib/agent/research-helpers": () => ({
          ...jest.requireActual("@/lib/agent/research-helpers"),
          finnhub: jest.fn(async (path: string) =>
            path.startsWith("/calendar/earnings") ? { data: { earningsCalendar: calendar } } : { data: null, error: "test: no vendor" },
          ),
        }),
      },
    });
  } finally {
    jest.useRealTimers();
  }
}

const flagOf = (result: { data?: Record<string, unknown> }) =>
  ((result.data?.theses as Array<{ resolved?: { planSanity?: Array<{ kind: string; text: string }> } }>)[0].resolved?.planSanity ?? []).find(
    (f) => f.kind === "NOTHING_CAN_WAKE",
  );

describe("nothing can wake it — the account's review before earnings", () => {
  it("no report date known (BBIO, 2026-10-07): the flag stays, and says why", async () => {
    const { result, crashed } = await readBbio([]);
    expect(crashed).toBe(false);
    expect(flagOf(result)?.text).toContain("Its earnings wake has no known date yet.");
  });

  it("a date already past is not a next report (JBL's 09-30 shape): the flag stays", async () => {
    const { result } = await readBbio([{ symbol: "BBIO", date: "2026-09-30", epsActual: 0.4, epsEstimate: 0.3 }]);
    expect(flagOf(result)?.text).toContain("Its earnings wake has no known date yet.");
  });

  it("a scheduled report ahead: the review will come, so no flag", async () => {
    const { result } = await readBbio([{ symbol: "BBIO", date: "2026-11-04", epsActual: null, epsEstimate: -0.6 }]);
    expect(flagOf(result)).toBeUndefined();
  });
});
