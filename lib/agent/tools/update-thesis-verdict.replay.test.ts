/**
 * A review's verdict and the line it answers ride on the audit row its call
 * writes. MU 2026-11-02 08:06 ET, the morning run's real update_thesis call
 * (read from the run's RunMessage thread), saved as a REVIEWED row; here it
 * also sends a verdict, its line, and the 10-30 note it speaks of.
 */
import { replayTool, thesisRow } from "@/lib/replay";
import fixture from "@/lib/agent/__fixtures__/mu-review-verdict-2026-11-02.json";

const LINE = "The HBM pricing assumption is intact but the 38.2% retracement at $878 broke, so the stock is weaker than the business.";
type Saved = { id: string; thesisId: string; type: string; rationale: string; verdict: string | null; verdictLine: string | null; answersUpdateId: string | null };

const replay = (extra: Record<string, unknown>) =>
  replayTool("update-thesis", "updateThesis", {
    seed: {
      thesis: [thesisRow({ ...fixture.thesis, analystId: fixture.analystId })],
      thesisUpdate: [{ ...fixture.answered, thesisId: fixture.thesis.id, timestamp: new Date(fixture.answered.timestamp) }],
    },
    ctx: { runMode: "MORNING_PLAN", runId: fixture.runId, analystId: fixture.analystId, runEnvironment: fixture.runEnvironment },
    args: { ...fixture.call, ...extra },
    quotes: { MU: fixture.price },
  });
const savedRow = (db: { store: Record<string, unknown[]> }) => (db.store.thesisUpdate as Saved[]).find((u) => u.thesisId === fixture.thesis.id && u.id !== fixture.answered.id)!;

describe("MU 11-02 morning review, with a verdict", () => {
  it("the saved row carries the verdict, its line and the line it answers, and is the REVIEWED row it was", async () => {
    const { result, refused, crashed, db } = await replay({ verdict: "WEAKER", verdict_line: LINE, answers_update_id: fixture.answered.id });
    expect([refused, crashed]).toEqual([false, false]);
    expect(result.data?.refused_fields).toBeUndefined();
    expect(savedRow(db)).toMatchObject({ type: fixture.saved.type, rationale: fixture.call.rationale, verdict: "WEAKER", verdictLine: LINE, answersUpdateId: fixture.answered.id });
  });

  it("a call that changes the plan writes an UPDATED row, and the verdict rides on it the same", async () => {
    const { db } = await replay({ stop_loss: 860, stop_basis: "Under the 10-30 low near $860.", verdict: "WEAKER", verdict_line: LINE });
    expect(savedRow(db)).toMatchObject({ type: "UPDATED", verdict: "WEAKER", verdictLine: LINE });
  });

  it("a verdict without a line saves; the word is read in any case", async () => {
    const { db } = await replay({ verdict: "weaker" });
    expect(savedRow(db)).toMatchObject({ type: "REVIEWED", verdict: "WEAKER", verdictLine: null, answersUpdateId: null });
  });

  it("an unknown word and an id not on this stock come back by name; the rest of the call lands", async () => {
    const { result, refused, db } = await replay({ verdict: "SOFTER", verdict_line: LINE, answers_update_id: "cmnotaline000000000000000" });
    expect(refused).toBe(false);
    expect((result.data?.refused_fields as Array<{ field: string }>).map((r) => r.field)).toEqual(["verdict", "answers_update_id"]);
    expect(savedRow(db)).toMatchObject({ type: "REVIEWED", rationale: fixture.call.rationale, verdict: null, verdictLine: LINE, answersUpdateId: null });
  });
});
