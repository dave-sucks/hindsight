/**
 * The Master Chat's read of the whole book carries each analyst's slots and
 * limits: "no cash, what do I sell?" turns on who is full and how much each
 * may hold. Before this, the unpinned read had no limits at all (its
 * slotsRemaining is null). The line is built from the gates' own numbers, so
 * "FULL" on screen is place_trade's refusal.
 *
 * The book as it stood at 15:45 ET on 2026-10-14, through the real execute.
 */
import { replayTool, positionRow, thesisRow, agentConfigRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";
import book from "@/lib/agent/__fixtures__/portfolio-master-chat-2026-10-14.json";

const nameOf = (id: string) => book.analysts.find((a) => a.id === id)!.name;
const seed = () => ({
  agentConfig: book.analysts.map((a) => agentConfigRow({ ...a, accountId: REPLAY_ACCOUNT_ID, createdAt: new Date(a.createdAt) })),
  position: book.positions.map((p) =>
    positionRow({ id: `pos_${p.symbol}`, symbol: p.symbol, analystId: p.analystId, analyst: { name: nameOf(p.analystId) }, status: p.status, environment: p.environment, avgCost: p.avgCost }),
  ),
});
const quotes = Object.fromEntries(book.positions.map((p) => [p.symbol, p.avgCost]));

async function read(analystId?: string) {
  const { result } = await replayTool("get-portfolio-context", "getPortfolioContext", {
    seed: seed(),
    ctx: { runMode: "PRINCIPAL_CHAT", runEnvironment: "LIVE", analystId },
    args: { include_thesis: false },
    quotes,
  });
  const { data } = result as unknown as { data: { summaryLines: string[] } };
  return data.summaryLines.filter((l) => / Largest trade /.test(l));
}

describe("get_portfolio_context — each analyst's room, on the whole book", () => {
  it("one line per analyst that holds here or can buy, with its slots, largest trade and most in one stock", async () => {
    expect(await read()).toEqual([
      "Catalyst Event PM: Positions: 1 of 5 — 4 free. Largest trade $8,000; most in one stock $16,000.",
      "Secular Compounder: Positions: 8 of 8 — this analyst is FULL. place_trade will refuse any new buy until one closes. Largest trade $10,000; most in one stock $20,000.",
      "PEAD Specialist: Positions: 3 of 6 — 3 free. Largest trade $14,000; most in one stock $28,000.",
    ]);
  });

  it("a chat pinned to one analyst gets none: its analyst's rules come in its brief", async () => {
    expect(await read("cmmqxola3000004lbj7c11bfn")).toEqual([]);
  });

  it("FULL is place_trade's own refusal: the Secular Compounder's next buy is refused at 8 of 8", async () => {
    const { result } = await replayTool("place-trade", "placeTrade", {
      seed: { ...seed(), thesis: [thesisRow({ id: "th_new", ticker: "ETN", analystId: "cmmqxola3000004lbj7c11bfn" })] },
      ctx: { runMode: "PRINCIPAL_CHAT", runEnvironment: "LIVE", analystId: "cmmqxola3000004lbj7c11bfn", maxOpenPositions: 8, minConfidence: 70, dryRun: true },
      args: { ticker: "ETN", direction: "LONG", entry_price: 400, thesis_id: "th_new" },
      quotes: { ETN: 400 },
    });
    expect((result as unknown as { data: { message: string } }).data.message).toMatch(/already has 8 open positions, at its 8-slot cap/);
  });
});
