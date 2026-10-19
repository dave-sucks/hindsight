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
  it("owes nothing when the thesis has a view, a floor and a target", () => {
    expect(researchOwed({ noView: false, floor: 95, target: 120 })).toBeNull();
  });
  it("owes the plan when either level is missing", () => {
    expect(researchOwed({ noView: false, floor: null, target: 120 })?.missing).toBe("floor");
    expect(researchOwed({ noView: false, floor: 95, target: null })?.missing).toBe("target");
  });
  it("owes the research when there was no view", () => {
    expect(researchOwed({ noView: true, floor: 95, target: 120 })?.missing).toBe("research");
  });
});

describe("sendWriterAfterBuy", () => {
  it("starts the writer for a researched thesis with no floor, keeping its levels", async () => {
    thesisFindUnique.mockResolvedValue({ stopLoss: null, targetPrice: 120 });
    startWriterRun.mockResolvedValue({ childRunId: "c1" });

    await expect(sendWriterAfterBuy(BUY)).resolves.toBe(true);
    expect(startWriterRun).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "refresh",
        existingThesisId: "t1",
        keepLevels: true,
        reason: "Bought by hand; set its floor and target.",
      }),
    );
    expect(writeThesisUpdate).not.toHaveBeenCalled();
  });

  it("sends no writer when the thesis has both levels", async () => {
    thesisFindUnique.mockResolvedValue({ stopLoss: 95, targetPrice: 120 });

    await expect(sendWriterAfterBuy(BUY)).resolves.toBe(false);
    expect(startWriterRun).not.toHaveBeenCalled();
  });

  it("writes one Activity line when the writer can't be started", async () => {
    thesisFindUnique.mockResolvedValue({ stopLoss: null, targetPrice: null });
    startWriterRun.mockRejectedValue(new Error("inngest down"));

    await expect(sendWriterAfterBuy(BUY)).resolves.toBe(false);
    expect(writeThesisUpdate).toHaveBeenCalledTimes(1);
    expect(writeThesisUpdate.mock.calls[0][0]).toMatchObject({
      thesisId: "t1",
      rationale: "Bought by hand with no floor — the write-up didn't start; the next run will set it.",
    });
  });
});
