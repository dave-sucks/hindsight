/**
 * record-thesis.conviction-replay.test.ts — a top-tier call without its
 * variant view is SAVED, one tier down, through the tool the writer calls
 * (DAV-316, DAV-311).
 *
 * Before: `record_thesis` refused "STRONG conviction requires variant_view"
 * and the whole thesis — research, plan, triggers — was thrown away. A
 * detail the app can fix is fixed by the app: the tier is stored as MEDIUM
 * and the reason sits next to the rationale, on the row.
 */
import { replayTool, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const mintArgs = {
  ticker: "DYN",
  company_name: "Dyne Therapeutics",
  direction: "LONG",
  status: "WATCHING",
  horizon: "CATALYST",
  catalyst_date: "2027-01-21T00:00:00.000Z",
  reasoning_summary: "Dated binary; watch until a base forms above the range low.",
  core_belief: "Dyne's DYNE-251 BLA is approved by the 2027-01-21 PDUFA date on the FDA's own accepted filing.",
  key_assumptions: ["No RTF or clinical hold before the date.", "Cash runway past the decision."],
  invalidation_conditions: ["A complete response letter.", "An equity raise below $12."],
  scoring: {
    trendStrength: { score: 0, note: "Broke the 200-day." },
    relativeStrength: { score: 0, note: "Lags SPY on every window." },
    entryQuality: { score: 0, note: "No base yet." },
    catalystFreshness: { score: 2, note: "PDUFA confirmed, 118 days out." },
  },
  conviction: "HIGH",
  conviction_rationale: "The date is the clearest possible dated catalyst; the chart is not there yet.",
  source_kind: "WEB_SEARCH",
  source_rationale: "PRE_CATALYST dispatch from the catalyst calendar.",
  current_price: 16.51,
  triggers: [
    { predicate: { kind: "REVIEW_CADENCE", days: 30 }, action: "REVIEW", rationale: "Wake in 30 days to see whether a base is forming." },
  ],
};

describe("record_thesis — STRONG/HIGH without a variant view", () => {
  it("saves the thesis with conviction MEDIUM and says why on the row", async () => {
    const { refused, refusal, db } = await replayTool("record-thesis", "recordThesis", {
      seed: { agentConfig: [agentConfigRow({ setupIds: ["PRE_CATALYST"] })], account: [accountRow()] },
      ctx: { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID },
      args: mintArgs,
      quotes: { DYN: 16.51 },
    });
    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    const rows = db.store.thesis as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].conviction).toBe("MEDIUM");
    expect(String(rows[0].convictionRationale)).toMatch(/Stored as MEDIUM: HIGH needs a variant view/);
    expect(rows[0].status).toBe("WATCHING");
  });

  it("with a variant view the tier is kept", async () => {
    const { refused, db } = await replayTool("record-thesis", "recordThesis", {
      seed: { agentConfig: [agentConfigRow({ setupIds: ["PRE_CATALYST"] })], account: [accountRow()] },
      ctx: { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID },
      args: { ...mintArgs, variant_view: "Consensus prices a CRL; the FDA asked for the data it now has." },
      quotes: { DYN: 16.51 },
    });
    expect(refused).toBe(false);
    expect((db.store.thesis as Array<Record<string, unknown>>)[0].conviction).toBe("HIGH");
  });
});
