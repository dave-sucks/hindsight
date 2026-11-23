/**
 * The Runs list under an account run. The Portfolio Digest and the Market Reviewer are made for the
 * whole account and touch no theses, but their cards read "No theses to walk", a line about a book
 * they have no part in. An analyst's run on an empty book keeps it.
 */
import { buildActionSegments, buildRunSummary, type RunSummaryInput } from "@/lib/run-summary";

const run = (over: Partial<RunSummaryInput>): RunSummaryInput => ({
  status: "COMPLETE",
  theses: [],
  decisions: [],
  managementActions: [],
  thesisUpdates: [],
  ...over,
});
const lineOf = (over: Partial<RunSummaryInput>) => buildActionSegments(buildRunSummary(run(over))).map((s) => s.text);

describe("the action line on a run that touched nothing", () => {
  it("says nothing under a Market Reviewer or a Portfolio Digest run", () => {
    expect(lineOf({ mode: "MARKET_REVIEWER" })).toEqual([]);
    expect(lineOf({ mode: "PORTFOLIO_DIGEST" })).toEqual([]);
  });

  it("still says it under an analyst's morning run on an empty book", () => {
    expect(lineOf({ mode: "MORNING_PLAN" })).toEqual(["No theses to walk"]);
    expect(lineOf({})).toEqual(["No theses to walk"]);
  });

  it("still says a digest run failed", () => {
    expect(lineOf({ mode: "PORTFOLIO_DIGEST", status: "FAILED" })).toEqual(["Run failed"]);
  });
});
