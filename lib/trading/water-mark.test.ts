/**
 * The high since we bought, from one five-minute pass's quote. Real rows and
 * tape: NVDA on 2026-10-06 (its high, $243.37, printed at 09:31 ET, before the
 * hourly monitor's first reading at 10:00) and MU on 2026-10-15, the day it
 * was bought at 11:06 ET after a morning low of $858.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { quoteFromSnapshot, type LiveQuote } from "@/lib/market-data/live-quote";
import { nextWaterMarks, type MarkedPosition } from "./water-mark";

const quote = (snap: Parameters<typeof quoteFromSnapshot>[0], now: Date, source: LiveQuote["source"] = "alpaca"): LiveQuote => ({
  ...quoteFromSnapshot(snap, now)!,
  source,
});

// NVDA, as stored before 10-06: the monitor's highest reading was 239.43 (10-05 15:00 ET).
const NVDA: MarkedPosition = {
  id: "position_NVDA", symbol: "NVDA", direction: "LONG", openedAt: new Date("2026-08-31T13:53:39.975Z"),
  peakPrice: 239.43, peakAt: new Date("2026-10-05T19:00:28.999Z"), troughPrice: 210.56, troughAt: new Date("2026-09-14T15:00:31.016Z"),
};
const NVDA_0935 = new Date("2026-10-06T13:35:05Z");
const NVDA_SNAP = {
  latestTrade: { p: 241.245, t: "2026-10-06T13:34:59Z" },
  dailyBar: { t: "2026-10-06T04:00:00Z", o: 242.1, h: 243.37, l: 240.76, c: 241.245 },
  prevDailyBar: { t: "2026-10-05T04:00:00Z", o: 236.09, h: 240.0983, l: 235.15, c: 238.9 },
};

// MU on its buy day, at the 15:55 pass: the monitor had 916.73 / 909.265.
const MU: MarkedPosition = {
  id: "position_MU", symbol: "MU", direction: "LONG", openedAt: new Date("2026-10-15T15:06:54.928Z"),
  peakPrice: 916.73, peakAt: new Date("2026-10-15T16:00:50.396Z"), troughPrice: 909.265, troughAt: new Date("2026-10-15T17:00:47.207Z"),
};
const MU_1555 = new Date("2026-10-15T19:55:05Z");
const MU_SNAP = {
  latestTrade: { p: 926.61, t: "2026-10-15T19:55:00Z" },
  dailyBar: { t: "2026-10-15T04:00:00Z", o: 871.575, h: 930, l: 858, c: 926.61 },
  prevDailyBar: { t: "2026-10-14T04:00:00Z", o: 934.56, h: 949.42, l: 913.56, c: 914.13 },
};

describe("nextWaterMarks", () => {
  it("held since before the open: the session's high counts, though the price has come off it", () => {
    expect(nextWaterMarks(NVDA, quote(NVDA_SNAP, NVDA_0935), NVDA_0935)).toEqual({ peakPrice: 243.37, peakAt: NVDA_0935 });
  });

  it("bought today: only the price counts — the day's low came before the buy", () => {
    expect(nextWaterMarks(MU, quote(MU_SNAP, MU_1555), MU_1555)).toEqual({ peakPrice: 926.61, peakAt: MU_1555 });
  });

  it("nothing moves when the price and the session sit inside the marks", () => {
    const held = { ...NVDA, peakPrice: 243.37 };
    expect(nextWaterMarks(held, quote(NVDA_SNAP, NVDA_0935), NVDA_0935)).toBeNull();
  });

  it("a stale quote moves nothing", () => {
    const later = new Date(NVDA_0935.getTime() + 20 * 60_000);
    expect(nextWaterMarks(NVDA, quote(NVDA_SNAP, NVDA_0935), later)).toBeNull();
  });

  it("outside the session nothing moves, even on a fresh last close", () => {
    const at = new Date("2026-10-06T20:05:00Z"); // 16:05 ET
    const snap = { ...NVDA_SNAP, latestTrade: { p: 239.24, t: "2026-10-06T19:59:59Z" } };
    expect(nextWaterMarks(NVDA, quote(snap, at), at)).toBeNull();
  });

  it("a Finnhub fallback quote: its day high is not used", () => {
    expect(nextWaterMarks(NVDA, quote(NVDA_SNAP, NVDA_0935, "finnhub"), NVDA_0935)).toEqual({ peakPrice: 241.245, peakAt: NVDA_0935 });
  });

  it("a short mirrors it: the low is its high-water mark", () => {
    const short = { ...NVDA, direction: "SHORT", peakPrice: 241, troughPrice: 243 };
    expect(nextWaterMarks(short, quote(NVDA_SNAP, NVDA_0935), NVDA_0935)).toEqual({
      peakPrice: 240.76, peakAt: NVDA_0935, troughPrice: 243.37, troughAt: NVDA_0935,
    });
  });

  it("a first reading sets both marks", () => {
    const fresh = { ...NVDA, peakPrice: null, peakAt: null, troughPrice: null, troughAt: null };
    expect(nextWaterMarks(fresh, quote(NVDA_SNAP, NVDA_0935), NVDA_0935)).toEqual({
      peakPrice: 243.37, peakAt: NVDA_0935, troughPrice: 240.76, troughAt: NVDA_0935,
    });
  });
});
