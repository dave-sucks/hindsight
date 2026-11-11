/**
 * market-digest-slot.ts — where the Market Reviewer's brief plugs into the
 * Market and portfolio block (lib/agent/market-and-portfolio.ts).
 *
 * Until the 7:30 market run exists this returns null, and the block shows no
 * market brief. The market run fills the body with a read of its newest
 * MarketDigest.brief for the book, with the time it was written; the block
 * prints it under "### Market brief" with its day and time, and leaves it out
 * once it is more than 4 days old. A throw counts as no brief. Nothing else
 * needs to change.
 */

/** A reviewer's brief: 3 to 5 sentences, 700 characters at most, for the New York day it was written. */
export interface Brief {
  /** YYYY-MM-DD, the New York day. */
  date: string;
  brief: string;
  /** When it was written (ISO): the block stamps the brief with its time as well as its day. */
  writtenAt?: string | null;
}

/** The newest market brief for the book. It takes the account and environment because the brief names that book's holdings. */
export async function latestMarketBrief(args: { accountId: string; environment: string }): Promise<Brief | null> {
  void args; // the market run's read of its newest MarketDigest.brief goes here
  return null;
}
