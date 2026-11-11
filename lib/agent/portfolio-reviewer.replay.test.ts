/**
 * The Portfolio Reviewer (lib/agent/portfolio-reviewer.ts) on the real facts
 * the 8 PM job builds for Tue Nov 10, from the stand-in book (lib/agent/__fixtures__/digest-facts-sample.ts)
 * and the four sales that were waiting (account-2026-11-10.json).
 *
 * The digests of those nights named the margin buying power and called the
 * account under-used, which reads as an order to buy: the writer was handed
 * the buying power, the idle cash and the empty slots. Cash is the broker's
 * cash now, and none of those reach it.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { SAMPLE_FACTS } from "@/lib/agent/__fixtures__/digest-facts-sample";
import nov10 from "@/lib/agent/__fixtures__/account-2026-11-10.json";
import type { DigestFacts } from "@/lib/portfolio/digest-facts";
import { buildReviewerInput, floorOfferProblems, parseReview, REVIEWER_PROMPT, writePortfolioReview, type PendingProposalFact } from "@/lib/agent/portfolio-reviewer";
import type { WaitingSale } from "@/lib/portfolio/sale-queue";
import { sentenceOf } from "@/lib/agent/triggers/condition";

const facts: DigestFacts = SAMPLE_FACTS;
const pending: PendingProposalFact[] = nov10.pending.map((o) => ({ ticker: o.symbol, side: o.side, intent: o.intent, quantity: o.quantity, analystName: o.analystName }));
/** The real queue that night, priced as the job prices it: at the facts' 8 PM prices, from the nearest priced line to each first proposal. */
const held = new Map(facts.book.held.map((h) => [h.ticker, h.currentPrice]));
const sales: WaitingSale[] = nov10.pending.map((o) => {
  const q = nov10.saleQueue.find((x) => x.symbol === o.symbol)!;
  const at = Date.parse(q.firstAt);
  const then = [...q.priced].sort((a, b) => Math.abs(Date.parse(a.at) - at) - Math.abs(Date.parse(b.at) - at))[0].price;
  return {
    ticker: o.symbol, kind: "sell", times: q.times, firstAt: q.firstAt, movePct: (held.get(o.symbol)! / then - 1) * 100, verdict: q.verdict,
    // The real floor that fired before each proposal; the note is a stand-in (the real one is the analyst's words).
    decision: { floor: sentenceOf({ action: "EXIT", predicate: q.fire.condition }), level: q.fire.condition.value, firedAt: q.fire.at, firedPrice: q.fire.price, note: `Stand-in note on ${o.symbol}.` },
  };
});
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 } as never;
const reply = (text: string) => ({ text, responseMessages: [{ role: "assistant" as const, content: text }], usage });

describe("what the Portfolio Reviewer reads on Nov 10", () => {
  const input = buildReviewerInput(facts, pending, sales);

  it("the account's cash, and never the margin buying power, idle cash or empty slots", () => {
    expect(facts.book.buyingPower).toBe(190000);
    expect(input).toContain("CASH: $25,000 (26.1% of the account).");
    expect(input).not.toMatch(/190,000|buying power|idle|slot|deploy/i);
  });

  it("each sale waiting as the owner's decision: its value, the floor that fired and where the price is, its history, its note in full", () => {
    const mu = input.slice(input.indexOf("  - sell MU"), input.indexOf("  - sell IOT"));
    expect(mu.split("\n").filter(Boolean)).toEqual([
      "  - sell MU 12 sh (Secular Compounder), about $8,701.32 at tonight's price of $725.11.",
      '    The floor that fired: "Sell if below $930.60", at 9:35 AM ET on Tue Nov 10 at $712.34. Tonight\'s price is 22.1% under it.',
      "    Proposed 9 times since Oct 29, −22.0% since; its note: case unchanged.",
      "    Its note today, in full:",
      "      Stand-in note on MU.",
    ]);
    expect(input).toContain('    The floor that fired: "Sell if below $236", at 9:35 AM ET on Tue Nov 10 at $171.81. Tonight\'s price is 28.4% under it.');
    expect(input).toContain("SALES WAITING FOR THE OWNER'S DECISION (oldest first). A crossed floor proposes its sale again every trading day until the owner approves it or lowers the floor; only the owner can lower a floor.");
    expect(input).toContain("ALL PROPOSALS WAITING: 4, about $30,883.32 at tonight's prices.");
  });

  it("says so when no floor fire or no note was found, rather than leaving a gap", () => {
    const bare = buildReviewerInput(facts, pending.slice(0, 1), [{ ...sales[0], decision: { floor: null, level: null, firedAt: sales[0].firstAt, firedPrice: null, note: null } }]);
    expect(bare).toContain("    The floor that fired: no fire was found before this proposal.");
    expect(bare).toContain("    Its note today: none was written.");
  });

  it("is told never to push the cash into the market", () => {
    expect(REVIEWER_PROMPT).toContain("Never suggest putting idle cash to work, filling empty slots or deploying more of the account");
  });

  it("is told the digest opens with each sale as the owner's decision, the choices by what the note says, and the brief never repeats a number", () => {
    const digest = REVIEWER_PROMPT.slice(REVIEWER_PROMPT.indexOf("## Digest"));
    expect(digest).toContain("1. The sales waiting, first: one short paragraph per sale, written as the owner's decision.");
    expect(digest).toContain("   - It argues to hold and names a price to hold at: approve the sale, or lower the floor to that price.");
    expect(digest).toContain("   - It argues to hold and names no price to hold at: approve the sale, or lower the floor yourself; the analyst names no level.");
    expect(digest).toContain(
      "   - It agrees with the sale: say the analyst agrees. The choices are approve the sale, or keep it waiting, and it is proposed again tomorrow; if you would rather hold, lowering the floor is yours to set, and the analyst names no level for it.",
    );
    expect(digest).toContain("A price the note gives for something else (a price to buy back at, a price that would change its mind, the floor itself) is never a floor to lower to");
    expect(digest).toContain("recommend nothing yourself, and never say hold or sell as your own advice.");
    const brief = REVIEWER_PROMPT.slice(REVIEWER_PROMPT.indexOf("## Brief"), REVIEWER_PROMPT.indexOf("## Digest"));
    expect(brief).toContain("never repeat a number (the value, the day's change, the cash, the holdings, the sales waiting)");
    expect(brief).toContain("sales piling up against the analysts' own notes");
  });
});

describe("the value is said to be at the close only when it is", () => {
  it("the VALUE line names the close the account is valued at, or says it is not one", () => {
    expect(buildReviewerInput(facts, [], [])).toContain("VALUE at the Tue Nov 10 close: $95,802.32; on the day -$1,475.68 (-1.52%), ");
    // A holding with no quote: the broker's marks, and no close is claimed.
    const marks = { ...facts, book: { ...facts.book, totalEquity: 96_793.85, closeOf: null, marketOpen: false }, pnl: { ...facts.pnl, dayPnl: -484.15, dayPnlPct: -0.4977 } };
    expect(buildReviewerInput(marks, [], [])).toContain("VALUE at 8:00 PM ET, not a close: $96,793.85; today -$484.15 (-0.50%), ");
    expect(REVIEWER_PROMPT).toContain("Say the account closed at a value only when the VALUE line gives it at the close.");
  });
});

/**
 * Nov 10's IOT and NVDA: both analysts agreed with the sale, and the digest
 * still offered to lower each floor "to that level", taking IOT's $42.70 (the
 * floor itself, named as what would change the call) and NVDA's $200.15 (where
 * it would look again, above the price). The notes are the analysts' words, so
 * stand-ins carry the same prices in the same roles.
 */
describe("the owner's choices follow what the note says (Nov 10's IOT and NVDA)", () => {
  const withNote = (ticker: string, note: string) => {
    const s = sales.find((x) => x.ticker === ticker)!;
    return { ...s, decision: { ...s.decision!, note } };
  };
  const iot = withNote("IOT", "Stand-in: agrees with the sale; would change the call only if the stock wins back $42.70 and holds there.");
  const nvda = withNote("NVDA", "Stand-in: agrees with the sale; would look again only once it rebuilds above $200.15.");
  const mu = withNote("MU", "Stand-in: argues to hold while it stays above $650.");
  const priceOf = (t: string) => held.get(t) ?? null;
  const fix = "Offer a floor price only when the note argues to hold and names that price, below tonight's.";

  it("a price the note gives for something else is sent back: the floor itself, or one at or above tonight's price", () => {
    const digest = [
      "On [IOT](thesis:t_iot), your floor is $42.70 and the price is now $41.45. The analyst says sell. Approve the sale, or lower the floor to $42.70 in the stock's triggers.",
      "On [NVDA](thesis:t_nvda), your floor is $236 and the price is now $168.89. The analyst says sell. Approve the sale, or lower the floor to $200.15 in the stock's triggers.",
    ].join("\n\n");
    expect(floorOfferProblems(digest, [iot, nvda], priceOf)).toEqual([
      `On IOT the digest offers to lower the floor to $42.70, which is the floor itself. ${fix}`,
      `On NVDA the digest offers to lower the floor to $200.15, which is at or above tonight's price of $168.89, so the floor would sell again at once. ${fix}`,
    ]);
  });

  it("the choices the rule gives pass: the analyst agrees with no level offered, or a hold note's own price below tonight's", () => {
    const digest = [
      "On [IOT](thesis:t_iot), your floor is $42.70 and the price is now $41.45. The analyst agrees with the sale. Approve the sale, or keep it waiting, and it is proposed again tomorrow; if you would rather hold, lowering the floor is yours to set, and the analyst names no level for it.",
      "On [MU](thesis:t_mu), your floor is $930.60 and the price is now $725.11. The analyst argues to hold above $650. Approve the sale, or lower the floor to $650.",
    ].join("\n\n");
    expect(floorOfferProblems(digest, [iot, mu], priceOf)).toEqual([]);
  });

  it("a price the note never names is sent back", () => {
    expect(floorOfferProblems("On MU: approve the sale, or lower the floor to $600.", [mu], priceOf)).toEqual([
      `On MU the digest offers to lower the floor to $600, which the analyst's note doesn't name. ${fix}`,
    ]);
  });

  it("the reviewer is asked once more when its digest offers such a price", async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce(reply("## Brief\nStand-in brief.\n## Digest\nOn IOT: approve the sale, or lower the floor to $42.70."))
      .mockResolvedValueOnce(reply("## Brief\nStand-in brief.\n## Digest\nOn IOT the analyst agrees: approve the sale, or keep it waiting."));
    const review = await writePortfolioReview(facts, pending, { generate, sales: [iot] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(String((generate.mock.calls[1][0] as { messages: Array<{ content: string }> }).messages.at(-1)?.content)).toContain("On IOT the digest offers to lower the floor to $42.70, which is the floor itself.");
    expect(review.narrative).toBe("On IOT the analyst agrees: approve the sale, or keep it waiting.");
  });

  it("other ways of offering a floor are caught too: 'its floor to around $X', 'set the floor at $X'", () => {
    expect(floorOfferProblems("On IOT you could lower its floor to around $42.70.", [iot], priceOf)).toHaveLength(1);
    expect(floorOfferProblems("On NVDA you could set the floor at $200.15.", [nvda], priceOf)).toHaveLength(1);
  });

  it("a price still offered after the retry: code writes that sale's paragraph, with no level", async () => {
    const offer = reply("## Brief\nStand-in brief.\n## Digest\nOn IOT: approve the sale, or lower the floor to $42.70.\n\nThe account fell.");
    const generate = jest.fn().mockResolvedValue(offer);
    const review = await writePortfolioReview(facts, pending, { generate, sales: [iot] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(review.narrative).toBe(
      "On IOT: proposed 13 times since Oct 16, +0.7% since; its note: case weaker. Your choices: approve the sale, or lower the floor yourself; the analyst names no level.\n\nThe account fell.",
    );
  });

  it("a retry that doesn't come back in the form never brings the first digest's price back", async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce(reply("## Brief\nStand-in brief.\n## Digest\nOn NVDA: approve the sale, or set the floor at $200.15."))
      .mockResolvedValueOnce(reply("Sorry, here it is again."));
    const review = await writePortfolioReview(facts, pending, { generate, sales: [nvda] });
    expect(review.narrative).not.toContain("$200.15");
    expect(review.narrative).toContain("On NVDA: proposed 27 times since Sep 14");
  });
});

describe("what the Portfolio Reviewer writes", () => {
  const BRIEF = "Stand-in brief. Four sales wait. NVDA reports Nov 17.";

  it("splits the reply into the brief, without links, and the digest, with them", () => {
    const parsed = parseReview(`## Brief\n${BRIEF} [MU](thesis:t1) leads them.\n\n## Digest\nThe account fell 1.1%. [MU](thesis:t1) is down.`);
    expect(parsed).toEqual({ brief: `${BRIEF} MU leads them.`, digest: "The account fell 1.1%. [MU](thesis:t1) is down.", problems: [] });
  });

  it("asks once more when the brief runs past 700 characters, and keeps the facts as the thread's first message", async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce(reply(`## Brief\n${"Too long. ".repeat(90)}\n## Digest\nFirst digest.`))
      .mockResolvedValueOnce(reply(`## Brief\n${BRIEF}\n## Digest\nSecond digest.`));
    const review = await writePortfolioReview(facts, pending, { generate });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(String((generate.mock.calls[1][0] as { messages: Array<{ content: string }> }).messages.at(-1)?.content)).toContain("The brief is 899 characters; the most is 700.");
    expect(review).toMatchObject({ brief: BRIEF, narrative: "Second digest.", model: "gpt-5.4" });
    expect(String(review.opening[0].content)).toMatch(/^FACTS:\nDATE: /);
    expect(review.messages).toHaveLength(3);
  });

  it("cuts a brief still too long at its last full sentence", async () => {
    const long = `${"A sentence of forty characters, roughly. ".repeat(20)}`;
    const generate = jest.fn().mockResolvedValue(reply(`## Brief\n${long}\n## Digest\nDigest.`));
    const review = await writePortfolioReview(facts, pending, { generate });
    expect(review.brief!.length).toBeLessThanOrEqual(700);
    expect(review.brief!.endsWith(".")).toBe(true);
  });

  it("when the model fails: the plain facts as the digest, and no brief", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const review = await writePortfolioReview(facts, pending, { generate: jest.fn().mockRejectedValue(new Error("503")) });
    expect(review).toMatchObject({ brief: null, model: "fallback" });
    expect(review.narrative).toContain("Cash $25,000.");
  });
});
