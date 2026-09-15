/**
 * get-earnings-calendar.reading-order.test.ts — replayed from the 2026-09-13
 * chat "do discovery for the PEAD Specialist based on earnings".
 *
 * The rows below are the ones that call returned (RunMessage
 * cmu05z26l000204jpjxw6vna3), first 31 by the order it showed them, plus
 * ORCL. The tool sorted reported rows by surprise % alone, so the top of the
 * 15 visible rows was NNOX ($5M quarter, "missed by 374%"), MIND, AOUT, RENT,
 * FEIM, PPIH — companies whose one-cent estimates make any result a huge
 * percentage. IOT, the name the chat bought on 09-14, sat at row 20: below
 * the visible cut. The agent only reached it by reading the raw rows.
 *
 * The /earnings page already reads real companies (≥ $100M expected quarterly
 * revenue) first. The tool now uses the same order.
 *
 * On main this test fails: NNOX is first and IOT is not in the visible rows.
 */

type Raw = [string, string, number, number, number, number];
// symbol, date, epsActual, epsEstimate, revenueActual, revenueEstimate
const ROWS: Raw[] = [
  ["NNOX", "2026-09-09", -0.79, -0.1666, 4160000, 5493036],
  ["AEO", "2026-09-09", 0.79, 0.2161, 1380380000, 1382876850],
  ["SWBI", "2026-09-03", 0.06, -0.051, 112590000, 100677570],
  ["MIND", "2026-09-08", -0.19, -0.0816, 5620000, 7833600],
  ["AENT", "2026-09-10", 0.13, 0.0612, 268100000, 244770420],
  ["AOUT", "2026-09-03", 0.03, -0.2448, 37250000, 36350250],
  ["AVAV", "2026-09-09", 0.59, 0.2892, 480490000, 467720041],
  ["CHWY", "2026-09-09", 0.36, 0.183, 3330200000, 3386318532],
  ["RENT", "2026-09-11", -0.2, -4.4166, 97700000, 85119000],
  ["LMNR", "2026-09-09", 0.02, 0.1904, 43810000, 46734360],
  ["FEIM", "2026-09-10", 0.41, 0.2244, 23450000, 18207000],
  ["LSAK", "2026-09-09", 0.15, 0.0918, 98500000, 186660000],
  ["AVO", "2026-09-08", 0.18, 0.1162, 450000000, 371149750],
  ["PPIH", "2026-09-09", 0.79, 0.561, 59570000, 52020000],
  ["GCO", "2026-09-03", -0.83, -1.3812, 529860000, 533684000],
  ["GLOO", "2026-09-09", -0.25, -0.187, 46570000, 44944596],
  ["SHOE", "2026-09-10", 0.23, 0.3366, 284310000, 303581916],
  ["TEN", "2026-09-10", 3.14, 2.5041, 246280000, 259435165],
  ["SIG", "2026-09-09", 2.19, 1.7538, 1528100000, 1545411100],
  ["IOT", "2026-09-03", 0.2, 0.1614, 508440000, 488094084],
  ["ODD", "2026-09-09", 0.2, 0.1616, 180520000, 177638577],
  ["VSXY", "2026-09-03", 0.95, 0.7873, 1610700000, 1651718130],
  ["BRZE", "2026-09-08", 0.19, 0.158, 227230000, 224273377],
  ["CIEN", "2026-09-03", 2.11, 1.7587, 1671130000, 1662569553],
  ["INNV", "2026-09-08", 0.06, 0.0748, 261950000, 243032003],
  ["NX", "2026-09-03", 0.79, 0.6772, 501850000, 512432210],
  ["FLWS", "2026-09-10", -0.8, -0.7004, 293120000, 299552243],
  ["LULU", "2026-09-03", 2.06, 1.8304, 2415630000, 2507391162],
  ["ASAN", "2026-09-03", 0.1, 0.0892, 216430000, 218405307],
  ["TTAN", "2026-09-08", 0.4, 0.3569, 292760000, 291675885],
  ["SUNB", "2026-09-09", 1.18, 1.0556, 3115000000, 3048948738],
  ["ORCL", "2026-09-10", 1.92, 1.7766, 19345000000, 19527219180],
];

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: jest.fn() }));
jest.mock("@/lib/actions/stock-info", () => ({ getStockInfo: jest.fn() }));
jest.mock("@/lib/agent/research-helpers", () => ({
  finnhub: jest.fn(async () => ({
    data: {
      earningsCalendar: ROWS.map(([symbol, date, epsActual, epsEstimate, revenueActual, revenueEstimate]) => ({
        symbol, date, hour: "amc", epsActual, epsEstimate, revenueActual, revenueEstimate, quarter: 2, year: 2027,
      })),
    },
  })),
}));

import { getEarningsCalendar } from "./get-earnings-calendar";
import type { ToolContext } from "@/lib/agent/tool-context";

// The PEAD Specialist's book on 09-13: six watches, three holdings.
const PEAD_BOOK = ["CRWD", "CSCO", "DOCU", "HPE", "PBH", "TOST", "FIVE", "MU", "NVDA"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (): Promise<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getEarningsCalendar({ runId: "chat_0913", userId: "u", accountId: "a", watchlist: PEAD_BOOK, positionTickers: [], groupId: (p: string) => p } as unknown as ToolContext) as any)
    .execute({ window: "reported", days: 10, scope: "universe" });

const tickerRows = (out: { data: { items: Array<{ kind: string; ticker?: string }> } }) =>
  out.data.items.filter((i) => i.kind === "ticker").map((i) => i.ticker);

describe("PEAD discovery, 2026-09-13 — the reported list's reading order", () => {
  it("puts real companies ahead of one-cent-estimate micro-caps", async () => {
    const out = await run();
    expect(out.ok).toBe(true);
    const visible = tickerRows(out);
    expect(visible[0]).toBe("AEO");
    for (const microCap of ["NNOX", "MIND", "AOUT", "RENT", "FEIM", "PPIH"]) {
      expect(visible).not.toContain(microCap);
    }
  });

  it("shows IOT — the name the chat bought — inside the visible rows", async () => {
    const out = await run();
    expect(tickerRows(out)).toContain("IOT");
  });

  it("still returns every row to the agent, micro-caps last", async () => {
    const out = await run();
    expect(out.data.count).toBe(ROWS.length);
    const last = out.data.rows.slice(-8).map((r: { symbol: string }) => r.symbol);
    expect(last.sort()).toEqual(["AOUT", "FEIM", "GLOO", "LMNR", "MIND", "NNOX", "PPIH", "RENT"]);
  });
});
