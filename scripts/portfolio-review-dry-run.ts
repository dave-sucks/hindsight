/**
 * portfolio-review-dry-run.ts — the Portfolio Reviewer on one evening's real
 * facts, saving nothing: no ResearchRun, no PortfolioDigest row, no token row.
 *
 *   npx tsx --env-file=.env.local scripts/portfolio-review-dry-run.ts --date 2026-11-10 [--account <id>] [--env LIVE] [--ticker MU] [--no-model]
 *
 * Builds the input the 8 PM job builds (lib/inngest/functions/portfolio-digest.ts:
 * buildDigestFacts, then loadWaitingForReview), calls the real model with the
 * real prompt once (twice if the reply needs fixing), and prints:
 *   1. the full input; 2. the brief; 3. the digest;
 *   4. the Market and portfolio block each analyst's morning run gets, and the
 *      one a trigger run on --ticker gets, with this brief as the portfolio brief.
 * --no-model prints the input and the blocks only, and costs nothing.
 *
 * The output carries the analysts' notes in full: keep it out of the repo.
 */
import { prisma } from "@/lib/prisma";
import { buildDigestFacts } from "@/lib/portfolio/digest-facts-builder";
import { loadWaitingForReview } from "@/lib/portfolio/load-sale-queue";
import { buildReviewerInput, PORTFOLIO_REVIEWER, writePortfolioReview } from "@/lib/agent/portfolio-reviewer";
import { loadMarketAndPortfolio } from "@/lib/agent/load-market-and-portfolio";
import { freshBrief, marketAndPortfolioBlock } from "@/lib/agent/market-and-portfolio";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getAccount, getPortfolioHistory } from "@/lib/alpaca";
import { getOwnerUserId } from "@/lib/auth/account";
import { addDays } from "@/lib/market-data/market-calendar";
import type { PriorClose } from "@/lib/portfolio/value-at-quotes";

/** gpt-5.4's price per million tokens (lib/agent/modes.ts). */
const PRICE = { input: 2.5, output: 15 };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const section = (title: string, body: string) => console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}\n${body}`);

async function main() {
  const accountId = arg("account") ?? "34f5c589-e216-4afe-9ee8-613c13f300e7";
  const environment = (arg("env") ?? "LIVE") as "PAPER" | "LIVE";
  const date = arg("date") ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const ticker = (arg("ticker") ?? "MU").toUpperCase();
  const noModel = process.argv.includes("--no-model");
  const now = new Date();

  console.log(`Portfolio Reviewer, dry run: account ${accountId}, ${environment}, the day ${date}. Read at ${now.toLocaleString("en-US", { timeZone: "America/New_York" })} ET. Nothing is saved.`);

  // At 8 PM the broker's prior close is the session before. Once it has moved on (overnight, after
  // the close), that close is read from Alpaca's daily history: the point before the one equal to
  // today's last_equity, matched by value (the history labels each close a day late).
  const ownerId = await getOwnerUserId(accountId);
  const owner = ownerId ? await resolveAlpacaCredentials(ownerId, environment).catch(() => null) : null;
  const account = await getAccount(owner ?? undefined);
  let priorClose: PriorClose | undefined;
  if (account.balance_asof && account.balance_asof >= date) {
    const history = await getPortfolioHistory({ period: "1M", timeframe: "1D" }, owner ?? undefined);
    const at = history.findLastIndex((p) => Math.abs(p.equity - Number(account.last_equity)) < 0.01);
    const before = at > 0 ? history[at - 1] : null;
    if (before) {
      priorClose = { equity: before.equity, asOf: addDays(before.date, -1) };
      console.log(
        `\nThe broker had already moved its prior close to the ${account.balance_asof} close ($${account.last_equity}). ` +
          `The close before it, $${before.equity}, is from Alpaca's daily history; the 8 PM job reads it from the broker.`,
      );
    }
  }

  // The facts and what's waiting, as the 8 PM job reads them.
  const facts = await buildDigestFacts(accountId, date, environment, { priorClose });
  const { pending, sales } = await loadWaitingForReview({ accountId, environment, facts });
  // The day's figure as the 8 PM job would have saved it, for the blocks once the broker has moved on.
  const closedDay = facts.pnl.dayUnknown ? undefined : { day: date, dollars: facts.pnl.dayPnl, pct: facts.pnl.dayPnlPct };

  section("1. THE INPUT (the reviewer's first message)", `FACTS:\n${buildReviewerInput(facts, pending, sales)}`);

  let brief: string | null = null;
  if (!noModel) {
    const review = await writePortfolioReview(facts, pending, { sales });
    brief = review.brief;
    const tokens = review.usage.reduce((t, u) => ({ input: t.input + (u.inputTokens ?? 0), output: t.output + (u.outputTokens ?? 0) }), { input: 0, output: 0 });
    const cost = (tokens.input * PRICE.input + tokens.output * PRICE.output) / 1e6;
    console.log(`\nModel: ${review.model}; ${review.usage.length} call(s); ${tokens.input} input + ${tokens.output} output tokens, about $${cost.toFixed(3)}.`);
    section(`2. THE BRIEF (${brief?.length ?? 0} characters; every agent reads it)`, brief ?? "(none: the model call failed, so no brief would be written tonight)");
    section("3. THE DIGEST (for the owner, on the home page)", review.narrative);
  }

  // The block as each analyst's run would read it. The newest brief would be tonight's, stamped at 8 PM
  // (until this PR's migration deploys, production has no brief column, so the loader can't read one).
  const tonight = brief ? { date, brief, writtenAt: new Date(`${date}T20:00:00-05:00`).toISOString() } : null;
  const blockFor = async (book: Parameters<typeof loadMarketAndPortfolio>[0]) => {
    const layer = await loadMarketAndPortfolio(book, now, { closedDay });
    const withBrief = tonight ? { ...layer, portfolioBrief: freshBrief(tonight, now), unread: layer.unread.filter((p) => p !== "portfolioBrief") } : layer;
    return marketAndPortfolioBlock(withBrief, now);
  };

  const analysts = await prisma.agentConfig.findMany({
    where: { accountId, enabled: true, tradingEnvironment: environment },
    select: { id: true, name: true, userId: true, accountId: true, tradingEnvironment: true, runDaysOfWeek: true },
    orderBy: { name: "asc" },
  });
  const blocks = new Map<string, string>();
  for (const a of analysts) {
    const creds = (await resolveAlpacaCredentials(a.userId, environment)) ?? undefined;
    const block = await blockFor({ accountId: a.accountId, environment: a.tradingEnvironment, userId: a.userId, analystId: a.id, creds });
    blocks.set(a.id, block);
    section(`4. THE MORNING RUN'S BLOCK: ${a.name} (run days ${(a.runDaysOfWeek ?? []).join(",")}; last in its system prompt)`, block);
  }

  // The trigger run loads it the same way, for the stock's analyst (lib/inngest/functions/tactical-run.ts).
  const position = await prisma.position.findFirst({
    where: { accountId, environment, status: "OPEN", symbol: ticker },
    select: { analyst: { select: { id: true, name: true, userId: true, accountId: true } } },
  });
  const a = position?.analyst;
  if (a) {
    const block = await blockFor({ accountId: a.accountId, environment, userId: a.userId, analystId: a.id });
    const same = blocks.get(a.id) === block ? ` It is the same as ${a.name}'s morning block.` : "";
    section(`5. A TRIGGER RUN ON ${ticker}: ${a.name} (before the stock's row in its system prompt)`, `${block}\n\n(${block.length} characters.${same})`);
  } else {
    section(`5. A TRIGGER RUN ON ${ticker}`, `No open ${ticker} position on this book.`);
  }
  console.log(`\n${PORTFOLIO_REVIEWER.name} dry run done. Nothing was written.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
