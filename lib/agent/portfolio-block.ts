/**
 * portfolio-block.ts — the Market and portfolio context: four reads of an
 * agent's context (lib/agent/engine/parts.ts), loaded together, each printed
 * under its own heading and all under "## Market and portfolio".
 *
 * - **Market numbers:** the indexes, the regime, the sectors, VIXY and the
 *   book's coming reports, written by code when the request is built
 *   (lib/market-data/market-numbers.ts). The same numbers get_market_context
 *   reports.
 * - **Market digest:** the 7:30 Market Reviewer's digest (the market's day,
 *   researched, with its sources), stamped, if it is from the last 4 days.
 *   Its own headings are moved down to ####, so they sit inside its part.
 * - **Portfolio snapshot:** the account's numbers, written by code when the
 *   request is built (lib/portfolio/snapshot.ts). The same text the 8 PM
 *   digest reads.
 * - **Portfolio digest:** the latest 8 PM digest, stamped with when it was
 *   written, if it is from the last 4 days.
 *
 * A part that can't be read says so in one line; it is never silently left
 * out. The house rules say how to weigh the block (lib/agent/engine/agents/rules.md).
 */
import { prisma } from "@/lib/prisma";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { portfolioPieceText } from "@/lib/portfolio/snapshot";

export { portfolioPieceText };
import { loadMarketNumbers } from "@/lib/market-data/load-market-numbers";
import { marketNumbersText } from "@/lib/market-data/market-numbers";

export const BLOCK_HEADING = "## Market and portfolio";
/** A digest older than this reads as none: it would describe a book that has moved on. */
export const DIGEST_SHELF_DAYS = 4;
/**
 * Digests the old writer wrote, from a dump of run ids, run logs and proposals
 * listed as trades, telling the reader to deploy the cash. The snapshot's
 * writer is gpt-5.4 (lib/agent/digest-writer.ts); no agent gets an old one.
 */
const OLD_DIGEST_MODEL = "gpt-4o";
/** How long a run waits for the snapshot and the market numbers before printing that they couldn't be read. The chat waits less (route.ts). */
const SNAPSHOT_WAIT_MS = 15_000;

const stamp = (d: Date) =>
  d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

function withinTime<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** `portfolioDigest: false` leaves the 8 PM digest out, for a reader that must form its own view. */
export interface BlockArgs { accountId: string; environment: string; now?: Date; waitMs?: number; portfolioDigest?: boolean }

/** The block's parts, each a read of its own in the agent engine (lib/agent/engine/parts.ts): market_numbers, market_digest, portfolio, portfolio_digest. */
export type PortfolioPieceId = "market_numbers" | "market_digest" | "portfolio_snapshot" | "portfolio_digest";
/** One part of the block, its own heading first. `unreadable` stands in for the whole block when nothing could be read. */
export interface PortfolioPiece { id: PortfolioPieceId | "unreadable"; text: string }

const UNREADABLE = "The portfolio snapshot and the digest couldn't be read for this request.";

/** The block's parts for one book, in order, without the block's heading. Never throws. */
export async function loadPortfolioPieces(args: BlockArgs): Promise<PortfolioPiece[]> {
  try {
    return await readPieces(args);
  } catch (err) {
    console.warn(`[portfolio-block] the block couldn't be read: ${err instanceof Error ? err.message : err}`);
    return [{ id: "unreadable", text: UNREADABLE }];
  }
}

async function readPieces(args: BlockArgs): Promise<PortfolioPiece[]> {
  const now = args.now ?? new Date();
  const environment = args.environment === "LIVE" ? "LIVE" : "PAPER";
  const wait = args.waitMs ?? SNAPSHOT_WAIT_MS;
  const [numbers, market, snapshot, digest] = await Promise.all([
    withinTime(loadMarketNumbers({ now, book: { accountId: args.accountId, environment } }), wait).catch((err) => {
      console.warn(`[portfolio-block] the market numbers couldn't be read: ${err instanceof Error ? err.message : err}`);
      return null;
    }),
    prisma.marketDigest
      .findFirst({ where: { accountId: args.accountId, environment }, orderBy: { date: "desc" }, select: { digest: true, createdAt: true } })
      .catch(() => null),
    withinTime(loadPortfolioSnapshot({ accountId: args.accountId, environment, now }), wait).catch((err) => {
      console.warn(`[portfolio-block] the snapshot couldn't be read: ${err instanceof Error ? err.message : err}`);
      return null;
    }),
    prisma.portfolioDigest
      .findFirst({ where: { accountId: args.accountId, environment, NOT: { model: OLD_DIGEST_MODEL } }, orderBy: { date: "desc" }, select: { narrative: true, createdAt: true } })
      .catch(() => null),
  ]);

  if (numbers === "timeout") console.warn(`[portfolio-block] the market numbers took over ${wait} ms`);
  if (snapshot === "timeout") console.warn(`[portfolio-block] the snapshot took over ${wait} ms for ${args.accountId} ${environment}`);
  else if (snapshot == null) console.warn(`[portfolio-block] no snapshot for ${args.accountId} ${environment} (no owner, no broker keys, or the broker failed)`);
  const pieces: PortfolioPiece[] = [];
  pieces.push({
    id: "market_numbers",
    text: numbers && numbers !== "timeout" ? `### Market numbers (as of ${stamp(now)} ET)\n${marketNumbersText(numbers)}` : "### Market numbers\nThe market numbers couldn't be read for this request.",
  });
  const marketFresh = market && now.getTime() - market.createdAt.getTime() <= DIGEST_SHELF_DAYS * 86_400_000;
  pieces.push({
    id: "market_digest",
    // Any heading it has (#, ## or ###) goes to ####, so it sits inside this part, never beside "## Market and portfolio".
    text: market && marketFresh ? `### Market digest (written ${stamp(market.createdAt)} ET)\n${market.digest.trim().replace(/^#{1,3} /gm, "#### ")}` : `### Market digest\nNo market digest in the last ${DIGEST_SHELF_DAYS} days.`,
  });
  const read = snapshot && snapshot !== "timeout" ? snapshot : null;
  pieces.push({ id: "portfolio_snapshot", text: portfolioPieceText(read) });
  if (args.portfolioDigest === false) return pieces;
  const fresh = digest && now.getTime() - digest.createdAt.getTime() <= DIGEST_SHELF_DAYS * 86_400_000;
  pieces.push({
    id: "portfolio_digest",
    text: digest && fresh ? `### Portfolio digest (written ${stamp(digest.createdAt)} ET)\n${digest.narrative.trim()}` : `### Portfolio digest\nNo digest written from the portfolio snapshot in the last ${DIGEST_SHELF_DAYS} days.`,
  });
  return pieces;
}
