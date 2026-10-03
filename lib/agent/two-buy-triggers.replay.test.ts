/**
 * two-buy-triggers.replay.test.ts — a save never leaves a stock with two buy
 * triggers. From the two saves that did, on 2026-10-02.
 *
 * SMMT (chat, Catalyst Event PM, 18:58 ET): the stock already carried its buy
 * as a chart condition — "closes above $17.10 and above the 20-day", an AND
 * trigger with action ENTER. The chat committed direction LONG and sent
 * entry_price 17.10, meaning that same buy. The buy slot in price-levels.ts
 * only sees PRICE_ABOVE / PRICE_BELOW triggers, so the AND buy was not in it
 * and "Entry set: $17.10" was added as a second ENTER. The principal removed
 * it by hand 25 minutes later.
 *
 * CRWD (writer mint, Secular Compounder, 21:21 ET): the writer sent
 * entry_price 242.28 (the 20-day) AND an ENTER trigger on NEAR_SMA 20 within
 * 2% in `triggers`. Both landed; the stock was born with two buys.
 *
 * Both go through the real tools, so the rule is proven where the saves
 * happened: `update_thesis` (through checkLadder) and `record_thesis`
 * (through its own call of the same guard).
 */
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

type Trig = { id: string; action: string; predicate: Record<string, unknown> };
const buysOf = (triggers: unknown): Trig[] => (triggers as Trig[]).filter((t) => t.action === "ENTER");

// ── SMMT as it stood before the 18:58 save ──────────────────────────────────
const SMMT_AND_BUY = "208a8dcf-74c4-4fdd-a8ff-1ab0d82b9fea";
const smmt = () =>
  thesisRow({
    id: "t_smmt",
    ticker: "SMMT",
    status: "WATCHING",
    direction: null,
    horizon: "CATALYST",
    setupId: "PRE_CATALYST",
    conviction: "HIGH",
    entryPrice: null,
    targetPrice: 19.55,
    stopLoss: 15.9,
    catalystDate: new Date("2026-11-14T00:00:00Z"),
    scoring: {
      composite: 7,
      entryQuality: { score: 1, note: "1.5% below the 20-day; fires on the next up close." },
      trendStrength: { score: 2, note: "Basing above the 200-day." },
      relativeStrength: { score: 2, note: "1M +17.6pts vs SPY after the gap." },
      catalystFreshness: { score: 2, note: "PDUFA November 14, 43 days out." },
    },
    triggers: [
      {
        id: SMMT_AND_BUY,
        action: "ENTER",
        source: "AGENT",
        predicate: {
          kind: "AND",
          predicates: [
            { kind: "PRICE_ABOVE", basis: "close", level: 17.1 },
            { kind: "VS_SMA", period: 20, direction: "ABOVE" },
          ],
        },
        rationale: "Reclaim entry: a close above $17.10 and above the 20-day, inside the buy window.",
        cooldownDays: 1,
        writtenAt: "2026-10-02T18:45:55.686Z",
        writtenPrice: 16.765,
      },
      {
        id: "129c7fe1-63e0-4c87-a715-782ba8bd1aeb",
        action: "EXIT",
        source: "AGENT",
        predicate: { kind: "PRICE_BELOW", level: 15.9 },
        rationale: "Under the September 29 gap-day low; 1.04 ATR below the $17.10 entry.",
        cooldownDays: 1,
      },
      {
        id: "95bbcef7-519e-4372-89e8-72f9be753888",
        action: "REVIEW",
        source: "AGENT",
        predicate: { kind: "PRICE_ABOVE", level: 19.55 },
        rationale: "Gap-day high and the 61.8% retracement bracket the target; 2.04R from $17.10.",
        cooldownDays: 1,
      },
      {
        id: "b2abd6e2-4207-40aa-b8f4-f217861e7f69",
        action: "REVIEW",
        source: "AGENT",
        predicate: { kind: "REVIEW_CADENCE", days: 7, from: "LAST_REVIEW" },
        rationale: "Weekly, with 43 days to the decision.",
        cooldownDays: 7,
      },
      {
        id: "0bf77aac-99b1-465c-979b-94079264fe21",
        action: "REVIEW",
        source: "AGENT",
        predicate: { kind: "REVIEW_CADENCE", days: 14, from: "EVENT", side: "BEFORE" },
        rationale: "Two weeks before the decision: hold through it, or take the run-up.",
        cooldownDays: 14,
      },
    ],
  });

/** The chat's call, as sent: direction LONG and the buy as a price. */
const smmtCommit = {
  thesis_id: "t_smmt",
  rationale:
    "Committing direction LONG to activate the priced plan. Plan unchanged: buy on a close above $17.10 and above the 20-day, floor $15.90, target $19.55.",
  price_at_time: 16.785,
  core_belief:
    "Ivonescimab + chemo receives FDA approval on November 14, 2026 on robust global PFS and improving Western OS.",
  key_assumptions: [
    "The FDA weighs the totality of the global data and approves by the PDUFA date without a complete response letter.",
    "Cash runway past the decision after the $2B strategic investment.",
  ],
  invalidation_conditions: [
    "A complete response letter citing Western OS.",
    "A PDUFA extension or late-cycle information request past November 14.",
  ],
  target_price: 19.55,
  stop_loss: 15.9,
  entry_on_close: true,
  entry_price: 17.1,
  conviction: "MEDIUM",
  conviction_rationale: "Strategic validation is real; Western OS is still not significant.",
  variant_view: "Consensus treats Western OS non-significance as near-fatal; the FDA weighs the totality.",
  direction: "LONG",
  horizon: "CATALYST",
};

// ── CRWD as the writer sent it (its third submission, the one that saved) ──
const crwdMint = {
  ticker: "CRWD",
  company_name: "CrowdStrike Holdings",
  direction: "LONG",
  status: "WATCHING",
  horizon: "COMPOUNDER",
  setup_id: "COMPOUNDER_ACCUMULATION",
  reasoning_summary:
    "Two quarters of re-accelerating ARR with raised guidance. 11.5% above the rising 20-day; arm the pullback entry at the 20-day with the stop under the 50-day.",
  entry_price: 242.28,
  target_price: 323.15,
  stop_loss: 218,
  stop_basis: "About 2.1 ATR below the 20-day entry, under the rising 50-day ($219.80).",
  target_basis: "1.272 extension of the April–October up-leg; 3.3R from entry.",
  entry_on_close: false,
  current_price: 270.04,
  scoring: {
    catalystFreshness: { score: 2, note: "Record net new ARR on August 26; next print December 1." },
    entryQuality: { score: 1, note: "11.5% above the 20-day; the pullback has not formed." },
    relativeStrength: { score: 3, note: "Leads SPY on every window." },
    trendStrength: { score: 3, note: "8/8 Trend Template, above every rising average." },
  },
  conviction: "HIGH",
  conviction_rationale: "Two blowout quarters with guide-raises; Falcon Flex lock-in; an incremental AI-security TAM.",
  variant_view:
    "Consensus models ARR growth decelerating toward 20%; the AI-security TAM is incremental and keeps net new ARR above $300M a quarter through FY28.",
  core_belief: "CrowdStrike compounds to $6B+ ARR by the end of FY28 as Falcon Flex drives platform consolidation.",
  key_assumptions: [
    "Net new ARR stays above $300M a quarter through FY28.",
    "Non-GAAP gross margin stays above 77%.",
  ],
  invalidation_conditions: [
    "Two consecutive quarters of net new ARR below $300M.",
    "Gross margin below 75% for two consecutive quarters.",
  ],
  triggers: [
    {
      action: "ENTER",
      predicate: { kind: "NEAR_SMA", period: 20, withinPct: 2 },
      rationale: "Pulled back to within 2% of the rising 20-day — the setup's entry condition.",
    },
    {
      action: "REVIEW",
      predicate: { kind: "PRICE_ABOVE", basis: "close", level: 275 },
      rationale: "Closed above $275 without the pullback — re-evaluate a breakout entry.",
    },
    {
      action: "REVIEW",
      predicate: { kind: "REVIEW_CADENCE", days: 30, from: "LAST_REVIEW" },
      rationale: "30-day watch clock.",
    },
    {
      action: "REVIEW",
      predicate: { kind: "EARNINGS_WITHIN", days: 7 },
      rationale: "Earnings December 1 — review the entry plan ahead of the print.",
    },
  ],
  source_kind: "WEB_SEARCH",
  source_rationale: "Mint requested on CRWD for the Secular Compounder.",
};

describe("a save never leaves a stock with two buy triggers", () => {
  it("SMMT: committing LONG with entry_price next to the existing AND buy is refused, naming both", async () => {
    const { refused, refusal, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [smmt()] },
      args: smmtCommit,
      quotes: { SMMT: 16.785 },
    });

    expect(refused).toBe(true);
    expect(refusal?.error).toBe("two_buy_triggers");
    expect(refusal?.message).toMatch(/Closes above \$17\.1/);
    expect(refusal?.message).toMatch(/above the 20-day|20-day/i);
    expect(refusal?.message).toContain(SMMT_AND_BUY);
    // Nothing moved: the stock still has its one buy, and is still undirected.
    const row = (db.store.thesis as Array<Record<string, unknown>>)[0];
    expect(buysOf(row.triggers).map((t) => t.id)).toEqual([SMMT_AND_BUY]);
    expect(row.direction).toBeNull();
  });

  it("SMMT: the same commit without entry_price lands, with the AND trigger as the buy", async () => {
    const { entry_price: _omit, ...withoutLevel } = smmtCommit;
    void _omit;
    const { refused, refusal, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [smmt()] },
      args: withoutLevel,
      quotes: { SMMT: 16.785 },
    });

    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    const row = (db.store.thesis as Array<Record<string, unknown>>)[0];
    expect(row.direction).toBe("LONG");
    expect(buysOf(row.triggers).map((t) => t.id)).toEqual([SMMT_AND_BUY]);
  });

  it("CRWD: a mint with entry_price and an ENTER trigger is refused, and nothing is minted", async () => {
    const { refused, refusal, db } = await replayTool("record-thesis", "recordThesis", {
      seed: { agentConfig: [agentConfigRow({ setupIds: ["COMPOUNDER_ACCUMULATION"] })], account: [accountRow()] },
      ctx: { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID },
      args: crwdMint,
      quotes: { CRWD: 270.04 },
    });

    expect(refused).toBe(true);
    expect(refusal?.message).toMatch(/2 buy triggers/);
    expect(refusal?.message).toMatch(/within 2% of the 20-day|20-day/i);
    expect(refusal?.message).toMatch(/\$242\.28/);
    expect(db.store.thesis ?? []).toHaveLength(0);
  });

  it("CRWD: the same mint with the chart buy alone saves with one buy trigger", async () => {
    const { entry_price: _omit, ...oneBuy } = crwdMint;
    void _omit;
    const { refused, refusal, db } = await replayTool("record-thesis", "recordThesis", {
      seed: { agentConfig: [agentConfigRow({ setupIds: ["COMPOUNDER_ACCUMULATION"] })], account: [accountRow()] },
      ctx: { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID },
      args: oneBuy,
      quotes: { CRWD: 270.04 },
    });

    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    const rows = db.store.thesis as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const buys = buysOf(rows[0].triggers);
    expect(buys).toHaveLength(1);
    expect(buys[0].predicate.kind).toBe("NEAR_SMA");
  });
});
