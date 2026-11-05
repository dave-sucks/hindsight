/**
 * voice.msft-replay.test.ts — Microsoft, 2026-11-04. The trigger run proposed
 * adding 4 shares, and its note, the reason the owner read on the proposal,
 * ran 163 words in three sentences of 50 to 70 words, with ten numbers and the
 * desk's words. The rules now ask for two to four sentences, about 60 to 90
 * words, said the way a markets podcaster would (lib/agent/voice.ts). The
 * note as saved fails that measure; the same facts in that voice fit it.
 */
import { noteCheck, numbersOf, sentencesOf, VOICE_RULES, wordsOf } from "@/lib/agent/voice";

/** The proposal's reason, word for word, from the stock's Activity. */
const SAVED =
  "Microsoft is higher today because investors are still reacting to the Oct. 28 earnings report, where Azure growth accelerated to 48%, commercial backlog rose to about $677 billion, and analysts pushed targets higher into a roughly $615 to $722 range, while today's post-election rotation also favored megacap software. That strengthens the reason we own it: the demand and backlog evidence moved with us rather than against us, and none of the business breaks we wrote down has happened; you own 17 shares at $531.01, up about $458, or 5.1%, and the stock is now through the old target area with the Street average at about $634. I proposed adding 4 shares because the move still confirms the multi-year Azure case rather than exhausting it, and I am raising the target to $634.08 and the floor to $524.57 under the post-breakout structure; I would change that only if Azure growth slips under our written guardrails or spending rises again without a matching demand step-up.";

/** The same note, the facts kept, in the voice the rules ask for. */
const REWRITTEN =
  "Microsoft keeps climbing after last week's earnings, when Azure's growth sped up to 48%, so I'm proposing we add 4 shares. This looks like real demand, not a one-day pop: you own 17 shares, up about 5%, and the stock is past our old target, so I'm moving the target and the floor up with it. The add waits for your approval. I'd back off if Azure's growth slows or spending jumps without the demand to match; the new floor at $524.57 is where I'd sell.";

describe("Microsoft, 2026-11-04: the add proposal's reason", () => {
  it("as saved: three sentences of 50 to 70 words, 163 words, ten numbers", () => {
    expect(wordsOf(SAVED)).toHaveLength(163);
    expect(sentencesOf(SAVED).map((s) => wordsOf(s).length)).toEqual([48, 58, 57]);
    expect(numbersOf(SAVED)).toEqual(["48%", "$677", "$615", "$722", "$531.01", "$458", "5.1%", "$634", "$634.08", "$524.57"]);
    expect(noteCheck(SAVED)).toEqual(["163 words, over 90", "the first sentence runs 48 words", "10 numbers (48%, $677, $615, $722, $531.01, $458, 5.1%, $634, $634.08, $524.57), over 3"]);
  });

  it("rewritten: the first sentence says what happened and what we're doing, the second takes a view; three numbers; 86 words", () => {
    expect(noteCheck(REWRITTEN)).toEqual([]);
    expect(wordsOf(REWRITTEN)).toHaveLength(86);
    expect(sentencesOf(REWRITTEN)).toHaveLength(4);
    expect(sentencesOf(REWRITTEN)[0]).toBe("Microsoft keeps climbing after last week's earnings, when Azure's growth sped up to 48%, so I'm proposing we add 4 shares.");
    expect(numbersOf(REWRITTEN)).toEqual(["48%", "5%", "$524.57"]);
  });

  it("the rules' own example note fits the rules", () => {
    const example = VOICE_RULES.match(/A note, for an invented company: "([^"]+)"/)![1];
    expect(noteCheck(example)).toEqual([]);
    expect(numbersOf(example)).toEqual(["6%", "$870", "$39.80"]);
  });

  it("the measure counts as the rules count: a date's day and a share count are not numbers, and the desk's words are named", () => {
    expect(numbersOf("On Oct. 28 you bought 17 shares at $531.01, up 5% on Nov. 3.")).toEqual(["$531.01", "5%"]);
    expect(sentencesOf("Eaton fell on Oct. 30 with U.S. industrials. I'm holding. The stop at $358.50 is where I'd sell.")).toHaveLength(3);
    expect(noteCheck("The catalyst is intact and the multiple can re-rate; our exposure and positioning are constructive on risk/reward into the print.").filter((o) => o.startsWith("desk word"))).toEqual([
      "desk word: catalyst",
      "desk word: constructive",
      "desk word: re-rate",
      "desk word: multiple",
      "desk word: risk/reward",
      "desk word: exposure",
      "desk word: positioning",
      "desk word: the print",
    ]);
  });
});
