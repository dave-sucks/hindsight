/**
 * A watch needs a next action, not a buy price.
 *
 * Committing a seed to a view used to demand both a buy (ENTER) and a Stop
 * watching line. Some playbooks start with only a review (PEAD waits for the
 * report; a parked pre-catalyst stock waits for its window), and a view that
 * fits no playbook is a watch with a review that brings it back. The commitment
 * is now one thing: a buy, or a review that can lead to one, on the stock or in
 * this call. A Stop watching line is optional.
 */
import { replayTool, thesisRow } from "@/lib/replay";

const SEED = thesisRow({
  ticker: "AAA",
  status: "WATCHING",
  direction: null,
  horizon: null,
  setupId: null,
  coreBelief: null,
  kpis: [],
  conviction: null,
  convictionRationale: null,
  triggers: [],
});

const COMMIT = {
  thesis_id: "thesis_replay",
  rationale: "Parked until the event window opens.",
  direction: "LONG",
  horizon: "CATALYST",
  catalyst_date: "2026-12-15T21:00:00Z",
  core_belief: "The readout in December clears the bar the market has priced in.",
  kpis: ["Enrollment finished on schedule.", "No safety signal in the interim look."],
  conviction: "MEDIUM",
  conviction_rationale: "Good setup, but the event is binary and a month out.",
};

const DATED_REVIEW = {
  predicate: { watch: "from_date", is: "before", value: 14, variable: "event" },
  action: "REVIEW",
  rationale: "Two weeks out, look again: is this the time to buy?",
};

const commit = (extra: Record<string, unknown>) =>
  replayTool("update-thesis", "updateThesis", {
    seed: { thesis: [{ ...SEED }] },
    args: { ...COMMIT, ...extra },
    ctx: { runMode: "PRINCIPAL_CHAT" },
    quotes: { AAA: 50 },
  });

describe("update_thesis — committing a seed needs one next action", () => {
  it("lands with only a dated review: no buy, no Stop watching line", async () => {
    const r = await commit({ add_triggers: [DATED_REVIEW] });
    expect(r.crashed).toBe(false);
    expect(r.refusal).toBeNull();
    expect(r.refused).toBe(false);

    const row = r.db.store.thesis[0];
    expect(row).toMatchObject({ status: "WATCHING", direction: "LONG", horizon: "CATALYST" });
    const stored = row.triggers as { action: string }[];
    expect(stored.map((t) => t.action)).toEqual(["REVIEW"]);
  });

  it("is refused with neither a buy nor a review, and the refusal names the next action", async () => {
    const r = await commit({ add_triggers: [] });
    expect(r.refused).toBe(true);
    expect(r.result.data?.error).toBe("pending_promotion_missing_fields");
    expect(r.result.data?.missing).toEqual([expect.stringContaining("a next action")]);
    expect(String(r.result.data?.message)).toMatch(/action ENTER.*action REVIEW/);
    expect(String(r.result.data?.message)).not.toContain("Stop watching line, action STOP_WATCHING, in add_triggers");
    expect(r.db.store.thesis[0].direction).toBeNull();
  });

  it("a Stop watching line alone is not a next action", async () => {
    const r = await commit({
      add_triggers: [{ predicate: { watch: "price", is: "below", value: 40, settings: { close: true } }, action: "STOP_WATCHING", rationale: "Below $40 the setup is over." }],
    });
    expect(r.refused).toBe(true);
    expect(r.result.data?.missing).toEqual([expect.stringContaining("a next action")]);
  });
});
