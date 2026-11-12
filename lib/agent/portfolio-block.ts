/**
 * portfolio-block.ts — the Market and portfolio block: what every agent that
 * decides on stocks is given about the whole account, on every request. The
 * morning run, the trigger run, the owner's chat and the Writer each print it
 * once, from here.
 *
 * Two parts so far, each under its own heading:
 * - **Portfolio snapshot:** the account's numbers, written by code when the
 *   request is built (lib/portfolio/snapshot.ts). The same text the 8 PM
 *   digest reads.
 * - **Portfolio digest:** the latest 8 PM digest, stamped with when it was
 *   written, if it is from the last 4 days.
 *
 * A part that can't be read says so in one line; it is never silently left
 * out. The house rules say how to weigh the block (house-rules.ts).
 */
import { prisma } from "@/lib/prisma";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { snapshotText } from "@/lib/portfolio/snapshot";

export const BLOCK_HEADING = "## Market and portfolio";
/** A digest older than this reads as none: it would describe a book that has moved on. */
export const DIGEST_SHELF_DAYS = 4;
/**
 * Digests the old writer wrote, from a dump of run ids, run logs and proposals
 * listed as trades, telling the reader to deploy the cash. The snapshot's
 * writer is gpt-5.4 (lib/agent/digest-writer.ts); no agent gets an old one.
 */
const OLD_DIGEST_MODEL = "gpt-4o";
/** How long a request waits for the snapshot before printing that it couldn't be read. */
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

/** The block's text for one book. Never throws. */
export async function loadPortfolioBlock(args: { accountId: string; environment: string; now?: Date }): Promise<string> {
  try {
    return await readBlock(args);
  } catch (err) {
    console.warn(`[portfolio-block] the block couldn't be read: ${err instanceof Error ? err.message : err}`);
    return [BLOCK_HEADING, "", "The portfolio snapshot and the digest couldn't be read for this request."].join("\n");
  }
}

async function readBlock(args: { accountId: string; environment: string; now?: Date }): Promise<string> {
  const now = args.now ?? new Date();
  const environment = args.environment === "LIVE" ? "LIVE" : "PAPER";
  const [snapshot, digest] = await Promise.all([
    withinTime(loadPortfolioSnapshot({ accountId: args.accountId, environment, now }), SNAPSHOT_WAIT_MS).catch((err) => {
      console.warn(`[portfolio-block] the snapshot couldn't be read: ${err instanceof Error ? err.message : err}`);
      return null;
    }),
    prisma.portfolioDigest
      .findFirst({ where: { accountId: args.accountId, environment, NOT: { model: OLD_DIGEST_MODEL } }, orderBy: { date: "desc" }, select: { narrative: true, createdAt: true } })
      .catch(() => null),
  ]);

  const parts = [BLOCK_HEADING, "", "### Portfolio snapshot"];
  parts.push(snapshot && snapshot !== "timeout" ? snapshotText(snapshot) : "The portfolio snapshot couldn't be read for this request.");
  parts.push("");
  const fresh = digest && now.getTime() - digest.createdAt.getTime() <= DIGEST_SHELF_DAYS * 86_400_000;
  if (digest && fresh) {
    parts.push(`### Portfolio digest (written ${stamp(digest.createdAt)} ET)`);
    parts.push(digest.narrative.trim());
  } else {
    parts.push("### Portfolio digest", `No digest written from the portfolio snapshot in the last ${DIGEST_SHELF_DAYS} days.`);
  }
  return parts.join("\n");
}
