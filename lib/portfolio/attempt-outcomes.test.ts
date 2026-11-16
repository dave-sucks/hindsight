/**
 * attempt-outcomes.test.ts — every case is a row from the live account
 * (34f5c589), 2026-08-31 → 09-28: the run, the orders around it, the
 * refusals inside it, and what the analyst wrote.
 */
import {
  attemptOutcomes,
  refusalReason,
  sideOfRefusal,
  type AttemptNote,
  type AttemptOrder,
  type AttemptRefusal,
  type AttemptRun,
} from "./attempt-outcomes";

const at = (iso: string) => new Date(iso);

const run = (o: Partial<AttemptRun> & { id: string; ticker: string; action: string; startedAt: Date }): AttemptRun => ({
  mode: "INTRADAY_TACTICAL",
  status: "COMPLETE",
  completedAt: new Date(o.startedAt.getTime() + 60_000),
  analystId: "pead",
  error: null,
  ...o,
});

const order = (o: Partial<AttemptOrder> & { symbol: string; intent: string; createdAt: Date }): AttemptOrder => ({
  status: "FILLED",
  updatedAt: o.createdAt,
  ...o,
});

const lines = (input: { runs: AttemptRun[]; orders?: AttemptOrder[]; refusals?: AttemptRefusal[]; notes?: AttemptNote[] }) =>
  attemptOutcomes({ orders: [], refusals: [], notes: [], ...input });

describe("a buy price is hit", () => {
  it("DOCU 09-28 09:30 — the analyst looked and chose not to: Buy passed, its note as written", () => {
    const docu = run({ id: "r_docu", ticker: "DOCU", action: "ENTER", startedAt: at("2026-09-28T13:30:00Z") });
    const out = lines({
      runs: [docu],
      notes: [
        {
          runId: "r_docu",
          ticker: "DOCU",
          timestamp: at("2026-09-28T13:30:40Z"),
          rationale:
            "Passed on the $DOCU entry. The trigger fired correctly and the live quote is still below $67, but the MA_PULLBACK setup's own confirmation is missing: this setup requires a reversal close above the prior day's high after touching the moving average, and at 09:30 ET we do not have that close yet. Price is also sitting below the 20-day moving average at $67.43 rather than reclaiming it.",
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "PASSED", ticker: "DOCU", label: "Buy passed", side: "BUY", runId: "r_docu" });
    // The whole note: the row shows what fits, the hover the rest.
    expect(out[0].reason).toMatch(/^Passed on the \$DOCU entry\. The trigger fired correctly/);
    expect(out[0].reason).toContain("Price is also sitting below the 20-day moving average at $67.43 rather than reclaiming it.");
  });

  it("VST 09-08 — a rule stopped it; a refusal with no sentence of its own shows its summary as written", () => {
    const out = lines({
      runs: [run({ id: "r_vst", ticker: "VST", action: "ENTER", startedAt: at("2026-09-08T13:35:00Z"), analystId: "compounder" })],
      refusals: [{ runId: "r_vst", tool: "place_trade", ticker: "VST", summary: "Trade blocked: $VST — below min composite", detail: null, createdAt: at("2026-09-08T13:35:30Z") }],
    });
    expect(out[0]).toMatchObject({ kind: "BLOCKED", label: "Buy blocked" });
    expect(out[0].reason).toBe("Trade blocked: $VST — below min composite");
  });

  it("ETN 09-11 — the refusal's own sentence is the reason", () => {
    const out = lines({
      runs: [run({ id: "r_etn", ticker: "ETN", action: "ENTER", startedAt: at("2026-09-11T13:45:00Z") })],
      refusals: [
        {
          runId: "r_etn", tool: "place_trade", ticker: "ETN",
          summary: "Trade blocked: $ETN — at max open positions",
          detail: "Trade blocked: this analyst already has 4 open positions, at its 4-slot cap. Close something first.",
          createdAt: at("2026-09-11T13:45:20Z"),
        },
      ],
    });
    expect(out[0].reason).toBe("Trade blocked: this analyst already has 4 open positions, at its 4-slot cap. Close something first.");
  });

  it("NVDA 08-31 — it was proposed, so the feed already has it: no line", () => {
    const out = lines({
      runs: [run({ id: "r_nvda", ticker: "NVDA", action: "ENTER", startedAt: at("2026-08-31T13:31:00Z") })],
      orders: [order({ symbol: "NVDA", intent: "OPEN", createdAt: at("2026-08-31T13:31:40Z") })],
    });
    expect(out).toEqual([]);
  });

  it("a refusal the run then fixed is not an outcome: refused on size, proposed a minute later", () => {
    const out = lines({
      runs: [run({ id: "r_abt", ticker: "ABT", action: "ENTER", startedAt: at("2026-09-11T12:06:00Z"), completedAt: at("2026-09-11T12:09:00Z") })],
      refusals: [{ runId: "r_abt", tool: "place_trade", ticker: "ABT", summary: "Trade blocked: $ABT — exceeds largest trade", detail: null, createdAt: at("2026-09-11T12:06:30Z") }],
      orders: [order({ symbol: "ABT", intent: "OPEN", createdAt: at("2026-09-11T12:07:30Z") })],
    });
    expect(out).toEqual([]);
  });

  it("the run broke: Buy failed, with what it said", () => {
    const out = lines({
      runs: [run({ id: "r_x", ticker: "GEV", action: "ENTER", startedAt: at("2026-09-20T14:00:00Z"), status: "FAILED", error: "Timed out after 770s" })],
    });
    expect(out[0]).toMatchObject({ kind: "FAILED", label: "Buy failed", reason: "Timed out after 770s" });
  });

  it("a run still going has no outcome yet", () => {
    expect(lines({ runs: [run({ id: "r_y", ticker: "GEV", action: "ENTER", startedAt: at("2026-09-20T14:00:00Z"), status: "RUNNING", completedAt: null })] })).toEqual([]);
  });
});

describe("an add trigger fires", () => {
  it("MU 09-14 — a refused manage_position call is a blocked add: the tool can only add or trim now, and its words are not read", () => {
    // Until 11-16 the summary's words ("Refused breakeven move") made this a
    // pass. manage_position lost its stop moves to update_thesis, so a refusal
    // of it is an add or a trim; the refusal stores no arguments to say which.
    const out = lines({
      runs: [run({ id: "r_mu", ticker: "MU", action: "ADD", startedAt: at("2026-09-14T13:40:00Z") })],
      refusals: [
        {
          runId: "r_mu", tool: "manage_position", ticker: "MU",
          summary: "Refused breakeven move on MU — the stop is already tighter than breakeven.",
          detail: "The stop is already $969.00, tighter than breakeven ($895.93).",
          createdAt: at("2026-09-14T13:40:30Z"),
        },
      ],
      notes: [{ runId: "r_mu", ticker: "MU", timestamp: at("2026-09-14T13:40:50Z"), rationale: "Not adding to $MU on a one-day spike. The floor already sits above breakeven." }],
    });
    expect(out[0]).toMatchObject({ kind: "BLOCKED", label: "Add blocked", reason: "The stop is already $969.00, tighter than breakeven ($895.93)." });
  });

  it("an add refused for room IS a blocked add", () => {
    const out = lines({
      runs: [run({ id: "r_ceg", ticker: "CEG", action: "ADD", startedAt: at("2026-09-14T19:30:00Z") })],
      refusals: [
        {
          runId: "r_ceg", tool: "manage_position", ticker: "CEG",
          summary: "Add would exceed the most this analyst may hold in one stock",
          detail: null, createdAt: at("2026-09-14T19:30:20Z"),
        },
      ],
    });
    expect(out[0]).toMatchObject({ kind: "BLOCKED", label: "Add blocked", side: "BUY" });
  });
});

describe("a sell line is broken", () => {
  it("ASML 09-15 — the analyst overrode its own floor: Held, not sold", () => {
    const out = lines({
      runs: [run({ id: "r_asml", ticker: "ASML", action: "EXIT", startedAt: at("2026-09-15T14:55:00Z"), analystId: "compounder" })],
      notes: [{ runId: "r_asml", ticker: "ASML", timestamp: at("2026-09-15T14:55:40Z"), rationale: "Reviewed the fired $1580 exit trigger on $ASML and I am overriding it to HOLD. The break came on a market-wide flush." }],
    });
    // The stock's timeline says "Trigger: Price below $1580 — held". Same word.
    expect(out[0]).toMatchObject({ kind: "PASSED", label: "Held, not sold", side: "SELL" });
  });

  it("SRRK — a sale already waiting for an answer is not a second attempt", () => {
    // Proposed the afternoon before, still unanswered when the line fired again.
    const out = lines({
      runs: [run({ id: "r_srrk", ticker: "SRRK", action: "EXIT", startedAt: at("2026-09-09T13:50:00Z") })],
      orders: [order({ symbol: "SRRK", intent: "CLOSE", status: "EXPIRED", createdAt: at("2026-09-08T21:30:00Z"), updatedAt: at("2026-09-09T16:00:00Z") })],
    });
    expect(out).toEqual([]);
  });

  it("…but one that was answered before the run began does not cover it", () => {
    const out = lines({
      runs: [run({ id: "r_srrk2", ticker: "SRRK", action: "EXIT", startedAt: at("2026-09-09T13:50:00Z") })],
      orders: [order({ symbol: "SRRK", intent: "CLOSE", status: "REJECTED", createdAt: at("2026-09-08T21:30:00Z"), updatedAt: at("2026-09-08T23:00:00Z") })],
    });
    expect(out.map((l) => l.label)).toEqual(["Held, not sold"]);
  });

  it("a buy order does not answer a sale", () => {
    const out = lines({
      runs: [run({ id: "r_z", ticker: "CEG", action: "EXIT", startedAt: at("2026-09-14T19:45:00Z") })],
      orders: [order({ symbol: "CEG", intent: "ADD", createdAt: at("2026-09-14T19:45:20Z") })],
    });
    expect(out.map((l) => l.label)).toEqual(["Held, not sold"]);
  });
});

describe("what is not an attempt", () => {
  it("a review trigger is not a transaction", () => {
    expect(lines({ runs: [run({ id: "r_rev", ticker: "ABT", action: "REVIEW", startedAt: at("2026-09-16T14:00:00Z") })] })).toEqual([]);
  });

  it("a morning run that touched no trade tool adds nothing", () => {
    expect(lines({ runs: [{ ...run({ id: "m1", ticker: "ABT", action: "ENTER", startedAt: at("2026-09-16T12:00:00Z") }), mode: "MORNING_PLAN", ticker: null, action: null }] })).toEqual([]);
  });
});

describe("a trade tool refused inside a morning run", () => {
  const morning: AttemptRun = {
    id: "m_run", mode: "MORNING_PLAN", status: "COMPLETE",
    startedAt: at("2026-09-23T12:00:00Z"), completedAt: at("2026-09-23T12:09:00Z"),
    analystId: "pead", ticker: null, action: null, error: null,
  };
  const refused: AttemptRefusal = {
    runId: "m_run", tool: "place_trade", ticker: "TOST",
    summary: "Trade blocked: $TOST — below min position size", detail: null,
    createdAt: at("2026-09-23T12:04:00Z"),
  };

  it("and never landed: Buy blocked", () => {
    const out = lines({ runs: [morning], refusals: [refused] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "BLOCKED", label: "Buy blocked", ticker: "TOST", runId: "m_run" });
    expect(out[0].reason).toBe("Trade blocked: $TOST — below min position size");
  });

  it("refused twice in the same run is one line", () => {
    expect(lines({ runs: [morning], refusals: [refused, { ...refused, createdAt: at("2026-09-23T12:05:00Z") }] })).toHaveLength(1);
  });

  it("and then landed in the same run: no line", () => {
    expect(
      lines({ runs: [morning], refusals: [refused], orders: [order({ symbol: "TOST", intent: "OPEN", createdAt: at("2026-09-23T12:06:00Z") })] }),
    ).toEqual([]);
  });
});

describe("no words are read", () => {
  it("a refusal's reason is its own sentence, else its summary, as written", () => {
    expect(refusalReason({ summary: "Trade blocked: $PLTR — market closed", detail: null })).toBe("Trade blocked: $PLTR — market closed");
    expect(refusalReason({ summary: "Trade blocked: $WST — the plan has no floor", detail: "Trade blocked: $WST's plan has no floor." })).toBe("Trade blocked: $WST's plan has no floor.");
  });

  it("which transaction a refusal refused comes from the tool alone", () => {
    expect(sideOfRefusal({ tool: "place_trade" })).toBe("BUY");
    expect(sideOfRefusal({ tool: "close_position" })).toBe("SELL");
    expect(sideOfRefusal({ tool: "manage_position" })).toBe("EITHER");
    expect(sideOfRefusal({ tool: "update_thesis" })).toBeNull();
  });
});
