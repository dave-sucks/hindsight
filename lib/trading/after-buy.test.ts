const thesisFindUnique = jest.fn();
const startWriterRun = jest.fn();
const writeThesisUpdate = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: { thesis: { findUnique: (...a: unknown[]) => thesisFindUnique(...a) } },
}));
jest.mock("@/lib/agent/thesis-writer-dispatch", () => ({
  startWriterRun: (...a: unknown[]) => startWriterRun(...a),
}));
jest.mock("@/lib/agent/thesis-updates", () => ({
  writeThesisUpdate: (...a: unknown[]) => writeThesisUpdate(...a),
}));

import { researchOwed, sendWriterAfterBuy } from "@/lib/trading/after-buy";

const BUY = {
  userId: "u1",
  accountId: "acc1",
  analystId: "a1",
  environment: "LIVE" as const,
  ticker: "ABT",
  thesisId: "t1",
  noView: false,
};

beforeEach(() => {
  thesisFindUnique.mockReset();
  startWriterRun.mockReset();
  writeThesisUpdate.mockReset();
});

describe("researchOwed", () => {
  it("owes nothing when the thesis has a view and a sale", () => {
    expect(researchOwed({ noView: false, hasSale: true })).toBeNull();
  });
  it("owes the sale when the stock has none", () => {
    expect(researchOwed({ noView: false, hasSale: false })?.missing).toBe("sale");
  });
  it("owes the research when there was no view", () => {
    expect(researchOwed({ noView: true, hasSale: true })?.missing).toBe("research");
  });
});

describe("sendWriterAfterBuy", () => {
  it("starts the writer for a researched thesis with no sale, keeping its triggers", async () => {
    thesisFindUnique.mockResolvedValue({ triggers: [] });
    startWriterRun.mockResolvedValue({ childRunId: "c1" });

    await expect(sendWriterAfterBuy(BUY)).resolves.toBe(true);
    expect(startWriterRun).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "refresh",
        existingThesisId: "t1",
        keepLevels: true,
        reason: "Bought by hand; set its sale.",
      }),
    );
    expect(writeThesisUpdate).not.toHaveBeenCalled();
  });

  it("sends no writer when the thesis has its sale", async () => {
    thesisFindUnique.mockResolvedValue({ triggers: [{ id: "s1", action: "EXIT", predicate: { watch: "price", is: "below", value: 95 }, rationale: "x" }] });

    await expect(sendWriterAfterBuy(BUY)).resolves.toBe(false);
    expect(startWriterRun).not.toHaveBeenCalled();
  });

  it("writes one Activity line when the writer can't be started", async () => {
    thesisFindUnique.mockResolvedValue({ triggers: [] });
    startWriterRun.mockRejectedValue(new Error("inngest down"));

    await expect(sendWriterAfterBuy(BUY)).resolves.toBe(false);
    expect(writeThesisUpdate).toHaveBeenCalledTimes(1);
    expect(writeThesisUpdate.mock.calls[0][0]).toMatchObject({
      thesisId: "t1",
      summary: "Bought ABT by hand; the write-up didn't start",
    });
    // A title, never a paragraph the app wrote.
    expect(writeThesisUpdate.mock.calls[0][0].rationale).toBeUndefined();
  });
});
