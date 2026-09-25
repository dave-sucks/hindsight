/**
 * complete-run.narration.test.ts — DAV-309, replayed from the four production
 * runs through complete_run's real entry point.
 *
 * FIVE 09-23 = cmue1xmut000004jsnq1mbnxm (PEAD)
 * MU   09-16 = cmu420ljf000o04l25ncehfma (PEAD)
 * SRRK 09-14 = cmu16y3f8000004ia2k1ywieg (Catalyst)
 */
import {
  replayTool,
  thesisRow,
  positionRow,
  thesisUpdateRow,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
} from "@/lib/replay";

const runRow = () => ({
  id: REPLAY_RUN_ID,
  status: "RUNNING",
  mode: "MORNING_PLAN",
  agentConfigId: REPLAY_ANALYST_ID,
  parameters: {},
  startedAt: new Date(),
  completedAt: null,
});

const summaryEvent = (payload: unknown) => ({
  id: "ev_summary",
  runId: REPLAY_RUN_ID,
  type: "run_summary",
  title: "Run Summary",
  message: "",
  payload,
  createdAt: new Date(),
});

/** FIVE 09-23, the FIRST summary — refused at 08:01:55 ET. */
const FIVE_PAYLOAD = {
  primary_decision: "ADJUST",
  ranked_picks: [
    { rank: 1, action: "HOLD", ticker: "MU", direction: "LONG", confidence: 90, composite_score: 9,
      reasoning: "Winner intact; raised floor under breakout pivot before earnings" },
    { rank: 2, action: "HOLD", ticker: "NVDA", direction: "LONG", confidence: 80, composite_score: 8,
      reasoning: "Healthy PEAD hold; reviewed and kept levels unchanged" },
    { rank: 3, action: "HOLD", ticker: "FIVE", direction: "LONG", confidence: 70, composite_score: 7,
      reasoning: "PEAD wobbling; tightened stop under 50-day support" },
  ],
  decision_rationale:
    "Adjusted existing risk rather than adding. MU remains the strongest held PEAD winner and today's +5% " +
    "move pushed it to +21.9% open gain, but its old floor only locked +8.2%; I raised protection to $1041 " +
    "under the $1042 breakout pivot. FIVE is the weakest holding under active review and the tape has " +
    "worsened — below the gap-day low with a 0.44 up/down volume ratio — so I tightened the stop from " +
    "$226.80 to $229.90 under the rising 50-day.",
};

/** MU 09-16, the FIRST summary — refused. */
const MU_PAYLOAD = {
  primary_decision: "HOLD",
  ranked_picks: [
    { rank: 1, action: "HOLD", ticker: "MU", direction: "LONG", confidence: 60, composite_score: 9,
      reasoning: "Reviewed exit fire; base still intact above swing low" },
  ],
  decision_rationale:
    "No new PEAD long cleared the bar this morning, so the right call was to maintain the book. MU's live " +
    "alert was reviewed against fresh price data and was held, not sold, because the stock stabilized back " +
    "near the 50-day and above the recent swing low, so the repeated exit fire looked like volatility " +
    "inside a base rather than a confirmed structural break.",
};

const heldBook = () => ({
  thesis: [
    thesisRow({ id: "t_mu", ticker: "MU", status: "HOLDING" }),
    thesisRow({ id: "t_nvda", ticker: "NVDA", status: "HOLDING" }),
    thesisRow({ id: "t_five", ticker: "FIVE", status: "HOLDING" }),
  ],
  position: [
    positionRow({ id: "p_mu", symbol: "MU", avgCost: 900 }),
    positionRow({ id: "p_nvda", symbol: "NVDA", avgCost: 170 }),
    positionRow({ id: "p_five", symbol: "FIVE", avgCost: 220 }),
  ],
  thesisUpdate: [
    thesisUpdateRow({ thesisId: "t_mu", runId: REPLAY_RUN_ID }),
    thesisUpdateRow({ thesisId: "t_five", runId: REPLAY_RUN_ID }),
  ],
});

const QUOTES = { MU: 1100, NVDA: 178, FIVE: 231, SRRK: 42 };

/** SRRK 09-14, the FIRST summary — EXIT with the sale already filled. */
const SRRK_PAYLOAD = {
  primary_decision: "ADJUST",
  ranked_picks: [
    { rank: 1, action: "HOLD", ticker: "SMMT", direction: "LONG", confidence: 70, composite_score: 7,
      reasoning: "High-conviction November FDA setup still intact; hold with gain protected." },
    { rank: 2, action: "EXIT", ticker: "SRRK", direction: "LONG", confidence: 80, composite_score: 8,
      reasoning: "FDA catalyst resolved; exit proposed after weak post-approval payoff." },
  ],
  decision_rationale:
    "Catalyst resolved on SRRK with approval in hand and a muted payoff, so I closed it and kept SMMT, " +
    "whose November FDA setup is still the strongest thing on this book.",
};

describe("DAV-309 — the summary check on the runs it actually blocked", () => {
  it("FIVE 09-23: stop tightened via update_thesis, summary said so → must complete", async () => {
    const { result, db } = await replayTool("complete-run", "completeRun", {
      // No position_modified event: the stop moved through update_thesis,
      // which is how stops move since triggers became one-at-a-time edits.
      seed: { researchRun: [runRow()], runEvent: [summaryEvent(FIVE_PAYLOAD)], ...heldBook() },
      args: {},
      quotes: QUOTES,
    });
    expect(result.summary).not.toMatch(/refused/i);
    expect(db.store.researchRun[0].status).toBe("COMPLETE");
  });

  it("MU 09-16: 'held, not sold' is a negation → must complete", async () => {
    const { result, db } = await replayTool("complete-run", "completeRun", {
      seed: { researchRun: [runRow()], runEvent: [summaryEvent(MU_PAYLOAD)], ...heldBook() },
      args: {},
      quotes: QUOTES,
    });
    expect(result.summary).not.toMatch(/refused/i);
    expect(db.store.researchRun[0].status).toBe("COMPLETE");
  });

  it("SRRK 09-14: EXIT with the sale actually filled → must complete", async () => {
    // The sale is real: Order cmu16ygim000304iave8dy28w, CLOSE/SELL, FILLED
    // at 12:00:31 — 36 seconds before the summary. No `position_closed`
    // RunEvent was ever written for it (none has been written since
    // 2026-08-01), which is exactly why the prose gate refused this run five
    // times until the analyst downgraded SRRK from EXIT to HOLD.
    const { result, db } = await replayTool("complete-run", "completeRun", {
      seed: {
        researchRun: [runRow()],
        runEvent: [summaryEvent(SRRK_PAYLOAD)],
        thesis: [
          thesisRow({ id: "t_smmt", ticker: "SMMT", status: "HOLDING" }),
          thesisRow({ id: "t_srrk", ticker: "SRRK", status: "HOLDING" }),
        ],
        position: [
          positionRow({ id: "p_smmt", symbol: "SMMT", avgCost: 14 }),
          positionRow({ id: "p_srrk", symbol: "SRRK", avgCost: 40 }),
        ],
        order: [
          {
            id: "cmu16ygim000304iave8dy28w",
            symbol: "SRRK",
            intent: "CLOSE",
            side: "SELL",
            status: "FILLED",
            createdAt: new Date(),
            position: { analystId: REPLAY_ANALYST_ID },
          },
        ],
        thesisUpdate: [thesisUpdateRow({ thesisId: "t_smmt", runId: REPLAY_RUN_ID })],
      },
      args: {},
      quotes: QUOTES,
    });
    expect(result.summary).not.toMatch(/refused/i);
    expect(db.store.researchRun[0].status).toBe("COMPLETE");
  });

  it("the real miss is still caught: held stock marked EXIT, nothing sold or proposed", async () => {
    // EV Catalyst/ON 2026-05-20 and Secular Theme/SMTC 2026-05-22 — the
    // shape the gate was built for. No order, no event.
    const { result, db } = await replayTool("complete-run", "completeRun", {
      seed: {
        researchRun: [runRow()],
        runEvent: [
          summaryEvent({
            primary_decision: "ADJUST",
            ranked_picks: [
              { rank: 1, action: "EXIT", ticker: "FIVE", direction: "LONG", confidence: 70,
                composite_score: 7, reasoning: "Drift failed; taking the loss." },
            ],
            decision_rationale:
              "FIVE's drift failed and the tape is broken, so the right move was to take the loss and " +
              "free the slot for a cleaner post-earnings setup later this week.",
          }),
        ],
        ...heldBook(),
      },
      args: {},
      quotes: QUOTES,
    });
    expect(result.summary).toMatch(/refused/i);
    expect(JSON.stringify(result)).toMatch(/\$FIVE is marked EXIT/);
    expect(db.store.researchRun[0].status).toBe("RUNNING");
  });

  it("a stock we do not hold owes nothing — the CRM/MIRM false alarms", async () => {
    const { result } = await replayTool("complete-run", "completeRun", {
      seed: {
        researchRun: [runRow()],
        runEvent: [
          summaryEvent({
            primary_decision: "WATCH",
            ranked_picks: [
              { rank: 1, action: "EXIT", ticker: "CRM", direction: "LONG", confidence: 40,
                composite_score: 4, reasoning: "Would exit if we owned it; we do not." },
            ],
            decision_rationale:
              "Nothing on the book changed today. CRM came up in the scan and the sell case is obvious, " +
              "but we hold none of it, so there is nothing to do beyond noting the view.",
          }),
        ],
        ...heldBook(),
      },
      args: {},
      quotes: QUOTES,
    });
    expect(result.summary).not.toMatch(/refused/i);
  });
});
