import { reviewProblem, type Review } from "./thesis-review";

const base: Review = {
  verdict: "UNCHANGED",
  verdictLine: undefined,
  convictionFrom: "MEDIUM",
  convictionTo: undefined,
  convictionReason: "The orders came in.",
  outlookFrom: "BULLISH",
  outlookTo: undefined,
  outlookReason: "The price reached the Street's average.",
  hasView: true,
  holding: true,
  saleOnRecord: false,
};
const ok = (r: Partial<Review>) => expect(reviewProblem({ ...base, ...r })).toBeNull();
const refused = (r: Partial<Review>, says: string) => expect(reviewProblem({ ...base, ...r })).toContain(says);

describe("how a review of a thesis ends", () => {
  it("needs one of the four verdicts", () => {
    refused({ verdict: undefined }, "End the note with its verdict");
    refused({ verdict: "HOLD" }, "End the note with its verdict");
    ok({ verdict: "unchanged" });
  });

  it("any verdict but unchanged says what happened", () => {
    refused({ verdict: "WEAKER" }, "Send verdict_line");
    ok({ verdict: "WEAKER", verdictLine: "Net new ARR came in under $120M at the Q3 report." });
  });

  it("conviction rises only on stronger and falls only on weaker or broken; unchanged never moves it", () => {
    refused({ verdict: "UNCHANGED", convictionTo: "LOW" }, "falls only on a WEAKER or BROKEN");
    refused({ verdict: "UNCHANGED", convictionTo: "HIGH" }, "rises only on a STRONGER");
    refused({ verdict: "WEAKER", verdictLine: "x", convictionTo: "HIGH" }, "rises only on a STRONGER");
    ok({ verdict: "STRONGER", verdictLine: "x", convictionTo: "HIGH" });
    ok({ verdict: "WEAKER", verdictLine: "x", convictionTo: "LOW" });
    // A verdict doesn't have to move it, and the same level sent again is no change.
    ok({ verdict: "STRONGER", verdictLine: "x", convictionFrom: "HIGH" });
    ok({ verdict: "UNCHANGED", convictionFrom: "HIGH", convictionTo: "HIGH" });
    // A first conviction, on a stock that had none, is not a move.
    ok({ verdict: "UNCHANGED", convictionFrom: null, convictionTo: "MEDIUM" });
  });

  it("outlook may change on any verdict: a rally turns bullish into neutral with the thesis unchanged", () => {
    ok({ verdict: "UNCHANGED", outlookTo: "NEUTRAL", convictionFrom: "HIGH" });
  });

  it("a stock with a view and no outlook yet gets one at its first look; a seed has none to rate", () => {
    refused({ outlookFrom: null }, "has no outlook yet");
    ok({ outlookFrom: null, outlookTo: "NEUTRAL" });
    ok({ outlookFrom: null, hasView: false });
  });

  it("a new conviction or outlook with no reason refuses the whole note, so one look is one line", () => {
    refused({ verdict: "WEAKER", verdictLine: "x", convictionTo: "LOW", convictionReason: undefined }, "Send conviction_rationale");
    refused({ outlookTo: "NEUTRAL", outlookReason: " " }, "Send outlook_reason");
    // The level it already has, sent again, is no change and needs no reason.
    ok({ convictionTo: "MEDIUM", convictionReason: undefined });
    ok({ outlookTo: "BULLISH", outlookReason: undefined });
  });

  it("broken can't stay bullish, and on a holding it comes with a sale", () => {
    refused({ verdict: "BROKEN", verdictLine: "x" }, "can't stay BULLISH");
    refused({ verdict: "BROKEN", verdictLine: "x", outlookTo: "BEARISH" }, "comes with its sale");
    ok({ verdict: "BROKEN", verdictLine: "x", outlookTo: "BEARISH", saleOnRecord: true });
    ok({ verdict: "BROKEN", verdictLine: "x", outlookTo: "NEUTRAL", holding: false });
  });
});
