/**
 * record-buy-blocked.test.ts — a buy the position limit blocked leaves one
 * visible line (DAV-286). Replay: ISRG, Secular Compounder, 2026-09-17
 * 16:40Z — confirmed, then blocked at 4 of 4, with nothing on screen.
 */
const mockThesisFindFirst = jest.fn();
const mockUpdateFindFirst = jest.fn();
const mockPositionFindMany = jest.fn();
const mockWrite = jest.fn().mockResolvedValue("u1");
jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: { findFirst: mockThesisFindFirst },
    thesisUpdate: { findFirst: mockUpdateFindFirst },
    position: { findMany: mockPositionFindMany },
  },
}));
jest.mock("@/lib/agent/thesis-updates", () => ({ writeThesisUpdate: mockWrite }));

import { buyBlockedSummary, recordBuyBlockedByFull } from "./record-buy-blocked";

const HELD = ["ABT", "ASML", "CEG", "WST"].map((symbol) => ({ symbol }));

beforeEach(() => {
  mockThesisFindFirst.mockReset().mockResolvedValue({ id: "isrg_thesis" });
  mockUpdateFindFirst.mockReset().mockResolvedValue(null);
  mockPositionFindMany.mockReset().mockResolvedValue(HELD);
  mockWrite.mockClear();
});

describe("ISRG 2026-09-17 — blocked at 4 of 4", () => {
  it("the line names the limit, the stock and what the analyst holds", () => {
    expect(buyBlockedSummary("ISRG", 4, 4, ["ABT", "ASML", "CEG", "WST"])).toBe(
      "Buy blocked — analyst full (4 of 4): $ISRG wants in; holds $ABT, $ASML, $CEG, $WST",
    );
  });

  it("writes one Activity line on the watched thesis", async () => {
    expect(await recordBuyBlockedByFull({ ticker: "ISRG", analystId: "compounder", open: 4, max: 4, runId: "run1" })).toBe(true);
    const row = mockWrite.mock.calls[0][0];
    expect(row.thesisId).toBe("isrg_thesis");
    expect(row.summary).toMatch(/^Buy blocked — analyst full \(4 of 4\): \$ISRG wants in/);
    expect(row.fieldChanges.buyBlocked.to).toEqual({ limit: "MAX_OPEN_POSITIONS", open: 4, max: 4, held: ["ABT", "ASML", "CEG", "WST"] });
  });

  it("one line per day, not one per pass — the second block that day writes nothing", async () => {
    mockUpdateFindFirst.mockResolvedValue({ id: "earlier" });
    expect(await recordBuyBlockedByFull({ ticker: "ISRG", analystId: "compounder", open: 4, max: 4 })).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("never turns a blocked buy into an error", async () => {
    mockThesisFindFirst.mockRejectedValue(new Error("db down"));
    expect(await recordBuyBlockedByFull({ ticker: "ISRG", analystId: "compounder", open: 4, max: 4 })).toBe(false);
  });
});
