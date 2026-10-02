import { addTokenUsage, emptyTokenUsage, recordTokenUsage } from "./token-usage";

const findUnique = jest.fn();
const update = jest.fn();
jest.mock("@/lib/prisma", () => ({
  prisma: {
    researchRun: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

describe("addTokenUsage", () => {
  it("sums every request, reading the cached count from either field the SDK uses", () => {
    const acc = emptyTokenUsage();
    addTokenUsage(acc, { inputTokens: 100, outputTokens: 10, totalTokens: 110, inputTokenDetails: { cacheReadTokens: 60 } });
    addTokenUsage(acc, { inputTokens: 200, outputTokens: 20, totalTokens: 220, cachedInputTokens: 150 });
    addTokenUsage(acc, undefined);
    expect(acc).toEqual({ input: 300, cachedInput: 210, output: 30, total: 330, requests: 2 });
  });

  it("counts a whole call's aggregate as the steps it took", () => {
    const acc = addTokenUsage(emptyTokenUsage(), { inputTokens: 900, outputTokens: 30, totalTokens: 930 }, 3);
    expect(acc.requests).toBe(3);
    expect(acc.cachedInput).toBe(0);
  });
});

describe("recordTokenUsage", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it("adds to what the run already recorded and keeps the rest of parameters", async () => {
    findUnique.mockResolvedValue({ parameters: { triggeredBy: "morning-cron", tokenUsage: { input: 50, cachedInput: 10, output: 5, total: 55, requests: 1, model: "gpt-5.4" } } });
    update.mockResolvedValue({});
    await recordTokenUsage("run1", { input: 100, cachedInput: 90, output: 10, total: 110, requests: 2 }, "gpt-5.4");
    expect(update).toHaveBeenCalledWith({
      where: { id: "run1" },
      data: {
        parameters: {
          triggeredBy: "morning-cron",
          tokenUsage: { input: 150, cachedInput: 100, output: 15, total: 165, requests: 3, model: "gpt-5.4" },
        },
      },
    });
  });

  it("writes nothing for a run that made no request, and never throws", async () => {
    await recordTokenUsage("run2", emptyTokenUsage(), "gpt-5.4");
    expect(findUnique).not.toHaveBeenCalled();
    findUnique.mockRejectedValue(new Error("db down"));
    await expect(
      recordTokenUsage("run3", { input: 1, cachedInput: 0, output: 1, total: 2, requests: 1 }, "gpt-5.4"),
    ).resolves.toBeUndefined();
  });
});
