/**
 * A refusal is never the end — the words that carry a refused call forward.
 * Rows are the real ones from 2026-09-25 (lib/agent/__fixtures__/refusals-2026-09-25.json).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import fixture from "./__fixtures__/refusals-2026-09-25.json";
import { blockedLastTimeSection, describeRefusal, refusalLinesFor, refusalNudge } from "./refusal-carryover";
import type { OpenRefusal } from "./gate-rejections";

type FixtureRow = { id: string; tool: string; summary: string; detail: string | null; ticker: string | null; runId: string; createdAt: string };
const row = (r: FixtureRow, extra: Partial<OpenRefusal> = {}): OpenRefusal => ({
  id: r.id, tool: r.tool, ticker: r.ticker, thesisId: null, summary: r.summary, detail: r.detail,
  runId: r.runId, createdAt: new Date(r.createdAt), ...extra,
});

const pltr = row(fixture.pltr_buy_refused);
const gd = row(fixture.gd_edit_refused, { ticker: "GD", thesisId: "gd-thesis" });

describe("describeRefusal — the line the model and the principal both read", () => {
  it("names the call in product words, the stock, and the tool's own reason", () => {
    const line = describeRefusal(pltr);
    expect(line).toMatch(/^Buy on \$PLTR \(place_trade\) — refused: Trade blocked: requested \$11,222 exceeds/);
  });
  it("a thesis edit reads as one", () => {
    expect(describeRefusal(gd)).toMatch(/^Thesis edit on \$GD \(update_thesis\) — refused: R\/R floor: 1\.93:1/);
  });
});

describe("refusalNudge — the retry turn after a run ends with a refusal undone", () => {
  it("says the work is still owed and gives the two legal answers", () => {
    const text = refusalNudge([pltr]);
    expect(text).toContain("One of your tool calls was refused and you never redid it");
    expect(text).toContain("A refusal is not a decision");
    expect(text).toContain("(a) correct the call and make it again");
    expect(text).toContain("(b) if the refusal stands");
    expect(text).toContain("1. Buy on $PLTR (place_trade) — refused:");
    expect(text).toContain("TOOL CALLS only");
  });
  it("counts more than one", () => {
    expect(refusalNudge([pltr, gd])).toContain("2 of your tool calls were refused");
  });
});

describe("blockedLastTimeSection — the next daily run is told", () => {
  it("is empty when nothing is open, so the prompt carries no empty heading", () => {
    expect(blockedLastTimeSection([])).toBe("");
  });
  it("lists each open refusal with its date and says it is shown to the principal until redone", () => {
    const s = blockedLastTimeSection([pltr]);
    expect(s).toContain("## Blocked last time — resolve today");
    expect(s).toContain("- 2026-09-25: Buy on $PLTR (place_trade) — refused:");
    expect(s).toContain("shown to the principal as open until the same tool lands on that stock");
  });
});

describe("refusalLinesFor — a tactical wake on the stock settles it too", () => {
  it("picks the rows on this thesis or stock, and nothing else", () => {
    const text = refusalLinesFor([pltr, gd], "other-thesis", "pltr");
    expect(text).toContain("Buy on $PLTR");
    expect(text).not.toContain("$GD");
  });
  it("matches by thesis id as well", () => {
    expect(refusalLinesFor([pltr, gd], "gd-thesis", "ZZZ")).toContain("Thesis edit on $GD");
  });
  it("is empty for a stock with nothing open", () => {
    expect(refusalLinesFor([pltr, gd], "x", "NVDA")).toBe("");
  });
});
