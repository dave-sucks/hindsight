/**
 * The Market and portfolio reads (market_numbers, market_digest, portfolio,
 * portfolio_digest): one read for the four (lib/agent/portfolio-block.ts),
 * once per run, printed under their one heading by the engine. The 8 PM
 * digest is written on the snapshot its job saves with it; the chat waits
 * 5 seconds at most.
 */
import { portfolioPieceText } from "@/lib/portfolio/snapshot";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";
import { once, type ContextRun } from "./fact";

export function loadPieces(run: ContextRun, want: { portfolioDigest: boolean }): Promise<PortfolioPiece[]> {
  const snapshot = run.given?.snapshot;
  if (snapshot) return Promise.resolve([{ id: "portfolio_snapshot", text: portfolioPieceText(snapshot) }]);
  return once(run, "market-and-portfolio", async () => {
    const { loadPortfolioPieces } = await import("@/lib/agent/portfolio-block");
    const { accountId, environment } = run.subject;
    return loadPortfolioPieces({ accountId, environment, now: run.now, ...want, ...(run.subject.kind === "chat" ? { waitMs: 5_000 } : {}) });
  });
}
