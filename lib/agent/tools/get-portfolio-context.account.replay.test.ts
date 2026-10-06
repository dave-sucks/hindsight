/**
 * get-portfolio-context.account.replay.test.ts — the chat with no analyst
 * selected can read the account (docs/plans/AGENT_ARCHITECTURE.md, step 5).
 *
 * On 2026-10-05 a chat with no analyst selected was asked what we own. Its
 * portfolio read came back "No analyst context — portfolio context
 * unavailable", so it listed positions and theses separately, pulled ten
 * single-stock reads to rebuild the prices, and still had no cash, equity or
 * open risk. The same read now covers the whole account when no analyst is
 * given, names each position's analyst, and filters by analyst when one is.
 *
 * The stop is the thesis's: MU's position row still said 969 that evening
 * while its plan's floor was 1048.
 *
 * Through the real get_portfolio_context execute, on that evening's book.
 */
import { replayTool, positionRow, thesisRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";
import book from "@/lib/agent/__fixtures__/portfolio-unscoped-chat-2026-10-05.json";

const seed = () => ({
  position: book.positions.map((p) =>
    positionRow({
      id: `pos_${p.symbol}`,
      symbol: p.symbol,
      analystId: p.analystId,
      analyst: { name: p.analyst },
      environment: "LIVE",
      quantity: 10,
      initialQty: 10,
      avgCost: p.avgCost,
      stopLoss: p.positionStop,
      targetPrice: p.positionTarget,
      peakPrice: p.peakPrice,
      exitStrategy: null,
      trailingStopPct: null,
      openedAt: new Date(`${p.openedAt}T14:00:00Z`),
    }),
  ),
  thesis: book.positions.map((p) =>
    thesisRow({
      id: p.thesisId,
      ticker: p.symbol,
      status: "HOLDING",
      direction: "LONG",
      stopLoss: p.thesisStop,
      targetPrice: p.thesisTarget,
      researchRun: { agentConfigId: p.analystId, agentConfig: { name: p.analyst, setupIds: [] } },
    }),
  ),
  portfolioDigest: [
    { id: "digest_1005", accountId: REPLAY_ACCOUNT_ID, environment: "LIVE", date: new Date(`${book.digest.date}T00:00:00Z`), narrative: book.digest.narrative },
  ],
});
const quotes = Object.fromEntries(book.positions.map((p) => [p.symbol, p.price]));

type Read = {
  summary?: string;
  data: {
    positions: Array<{ symbol: string; analyst: string | null; stopLoss: number | null; unrealizedPnlPct: number }>;
    capitalSummary: { cash: number; totalEquity: number; slotsRemaining: number | null } | null;
    digest: { date: string; narrative: string } | null;
  };
};

async function read(ctx: Record<string, unknown>): Promise<Read> {
  const { result } = await replayTool("get-portfolio-context", "getPortfolioContext", {
    seed: seed(),
    ctx: { runMode: "PRINCIPAL_CHAT", runEnvironment: "LIVE", ...ctx },
    args: { include_thesis: true },
    quotes,
  });
  return result as unknown as Read;
}

describe("get_portfolio_context — the account", () => {
  it("with no analyst selected: every position on the account, each with its analyst, gain and stop", async () => {
    const r = await read({ analystId: undefined });
    expect(r.summary).not.toMatch(/unavailable/i);
    expect(r.data.positions.map((p) => p.symbol).sort()).toEqual(["CEG", "CORT", "MU", "NVDA"]);
    expect(new Set(r.data.positions.map((p) => p.analyst))).toEqual(new Set(["PEAD Specialist", "Secular Compounder", "Catalyst Event PM"]));
    const ceg = r.data.positions.find((p) => p.symbol === "CEG")!;
    expect(ceg.unrealizedPnlPct).toBeLessThan(0);
    expect(ceg.stopLoss).toBe(248);
  });

  it("the cash, the equity and the latest digest come with it; no analyst, so no position limit", async () => {
    const r = await read({ analystId: undefined });
    expect(r.data.capitalSummary?.cash).toBeGreaterThan(0);
    expect(r.data.capitalSummary?.totalEquity).toBeGreaterThan(0);
    expect(r.data.capitalSummary?.slotsRemaining).toBeNull();
    expect(r.data.digest).toEqual({ date: "2026-10-05", narrative: book.digest.narrative });
  });

  it("the stop is the plan's: MU reads 1048, not the position row's 969", async () => {
    const r = await read({ analystId: undefined });
    expect(r.data.positions.find((p) => p.symbol === "MU")!.stopLoss).toBe(1048);
  });

  it("with an analyst: only that analyst's positions", async () => {
    const r = await read({ analystId: "cmnhxpjio000004jvox6kl6c7" });
    expect(r.data.positions.map((p) => p.symbol).sort()).toEqual(["MU", "NVDA"]);
  });

  it("one book at a time: the paper book of the same account is empty", async () => {
    const r = await read({ analystId: undefined, runEnvironment: "PAPER" });
    expect(r.data.positions).toEqual([]);
    expect(r.data.digest).toBeNull();
  });
});
