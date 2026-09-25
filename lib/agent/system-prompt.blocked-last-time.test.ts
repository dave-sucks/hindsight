/** The daily run is told about refused calls it never redid (2026-09-25). */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildDailyRunSystemPromptV2 } from "./system-prompt";
import type { RunInput } from "./run-input";
import fixture from "./__fixtures__/refusals-2026-09-25.json";

const base = {
  analyst: { name: "Secular Compounder", mandate: null, voice: null, directionBias: "LONG_ONLY", holdDurations: ["SWING"], sectors: [], industries: [], themes: [], marketCapMin: null, marketCapMax: null, exclusionList: [], minConfidence: 70, minPositionSize: 3000, maxPositionSize: 10000, maxOpenPositions: 6 },
  portfolio: { cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
  watchlist: [], activeTheses: [], performance: null, recentClosedTrades: [], priorityReviews: [],
  triggersFiredSinceLastRun: [], triggersMatchingNow: [], latestDigest: null,
  earnings: { reportingSoon: [], justReported: [] }, filings: { recent: [] },
  intelligencePolicy: { maxSignalsPerRun: 0 },
};
const cfg = { name: "Secular Compounder", minConfidence: 70, maxPositionSize: 10000, minPositionSize: 3000, maxOpenPositions: 6 };

describe("Blocked last time", () => {
  it("the Monday after PLTR: the prompt names the refused buy and says it is still owed", () => {
    const r = fixture.pltr_buy_refused;
    const prompt = buildDailyRunSystemPromptV2(cfg, {
      ...base,
      openRefusals: [{ id: r.id, tool: r.tool, ticker: r.ticker, thesisId: null, summary: r.summary, detail: r.detail, runId: r.runId, createdAt: new Date(r.createdAt) }],
    } as unknown as RunInput);
    expect(prompt).toContain("## Blocked last time — resolve today");
    expect(prompt).toContain("- 2026-09-25: Buy on $PLTR (place_trade) — refused: Trade blocked: requested $11,222");
  });
  it("carries no such section when nothing is open", () => {
    const prompt = buildDailyRunSystemPromptV2(cfg, { ...base, openRefusals: [] } as unknown as RunInput);
    expect(prompt).not.toContain("Blocked last time");
  });
  it("the size band no longer promises a refusal place_trade does not make", () => {
    const prompt = buildDailyRunSystemPromptV2(cfg, { ...base, openRefusals: [] } as unknown as RunInput);
    expect(prompt).toContain("place_trade sizes every buy inside this band by risk");
    expect(prompt).not.toContain("an undersized entry is rejected, not resized");
  });
});
