import { detectNarrationHits, findGaps, type ToolCallEvent } from "./narration-gate";

const KNOWN = (tickers: string[]) => new Set(tickers.map((t) => t.toUpperCase()));

// ─── detectNarrationHits ─────────────────────────────────────────────────────

describe("detectNarrationHits", () => {
  it("catches close_position narration with $TICKER", () => {
    const hits = detectNarrationHits(
      "$INTC closed due to overextension",
      "rationale",
      undefined,
      KNOWN(["INTC"]),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      ticker: "INTC",
      expectedTool: "close_position",
    });
  });

  it("catches close_position narration with bare ticker when in known set", () => {
    const hits = detectNarrationHits(
      "Closing TSM at the target now that the breakout has played out.",
      "rationale",
      undefined,
      KNOWN(["TSM", "AVGO"]),
    );
    const closeHits = hits.filter((h) => h.expectedTool === "close_position");
    expect(closeHits).toHaveLength(1);
    expect(closeHits[0].ticker).toBe("TSM");
  });

  it("ignores bare uppercase tokens that aren't known tickers", () => {
    const hits = detectNarrationHits(
      "Closed BY EOD per AI macro thesis",
      "rationale",
      undefined,
      KNOWN(["NVDA"]), // BY/EOD/AI not in set
    );
    expect(hits).toHaveLength(0);
  });

  it("attributes pick_reasoning to the pick's ticker without needing $TICKER", () => {
    const hits = detectNarrationHits(
      "Tightened the stop to $32 — momentum cooling but still long.",
      "pick_reasoning",
      "CAPR",
      KNOWN(["CAPR"]),
    );
    const tighten = hits.filter((h) => h.expectedTool === "manage_position");
    expect(tighten.length).toBeGreaterThan(0);
    expect(tighten[0].ticker).toBe("CAPR");
  });

  it("catches 'tightening the stop on $X'", () => {
    const hits = detectNarrationHits(
      "I'll tighten the stop on $CAPR to $32.",
      "rationale",
      undefined,
      KNOWN(["CAPR"]),
    );
    expect(hits.some((h) => h.expectedTool === "manage_position" && h.ticker === "CAPR")).toBe(true);
  });

  it("catches 'trimmed' as manage_position", () => {
    const hits = detectNarrationHits(
      "Trimmed $NVDA into the rip — half off, riding rest with trail to $720.",
      "rationale",
      undefined,
      KNOWN(["NVDA"]),
    );
    const mp = hits.filter((h) => h.expectedTool === "manage_position" && h.ticker === "NVDA");
    expect(mp.length).toBeGreaterThanOrEqual(1);
  });

  it("catches 'scaled out of $X'", () => {
    const hits = detectNarrationHits(
      "Scaled out of $AVGO 50% at the gap-fill.",
      "rationale",
      undefined,
      KNOWN(["AVGO"]),
    );
    expect(hits.some((h) => h.expectedTool === "manage_position" && h.ticker === "AVGO")).toBe(true);
  });

  it("'added to' attributes to manage_position, not manage_watchlist", () => {
    const hits = detectNarrationHits(
      "Added to $MU after the post-print follow-through.",
      "rationale",
      undefined,
      KNOWN(["MU"]),
    );
    expect(hits.some((h) => h.expectedTool === "manage_position" && h.ticker === "MU")).toBe(true);
    expect(hits.some((h) => h.expectedTool === "manage_watchlist")).toBe(false);
  });

  it("'added $X to watchlist' attributes to manage_watchlist", () => {
    const hits = detectNarrationHits(
      "Added $SMCI to the watchlist for next week's print.",
      "rationale",
      undefined,
      KNOWN(["SMCI"]),
    );
    expect(hits.some((h) => h.expectedTool === "manage_watchlist" && h.ticker === "SMCI")).toBe(true);
  });

  it("'removing $X from watchlist' attributes to manage_watchlist", () => {
    const hits = detectNarrationHits(
      "Removing $FIVN from the watchlist — thesis no longer holds.",
      "rationale",
      undefined,
      KNOWN(["FIVN"]),
    );
    expect(hits.some((h) => h.expectedTool === "manage_watchlist" && h.ticker === "FIVN")).toBe(true);
  });

  it("returns empty for benign reasoning text", () => {
    const hits = detectNarrationHits(
      "Maintaining current LONG thesis. Catalyst still ahead, structure intact.",
      "pick_reasoning",
      "NVDA",
      KNOWN(["NVDA"]),
    );
    expect(hits).toHaveLength(0);
  });

  it("ignores text with no nearby ticker", () => {
    const hits = detectNarrationHits(
      "Tightened risk across the book; no specific name to call out.",
      "rationale",
      undefined,
      KNOWN(["NVDA", "MU"]),
    );
    expect(hits).toHaveLength(0);
  });

  it("ignores $X placeholder pseudo-tickers", () => {
    const hits = detectNarrationHits(
      "Plan: tighten stop on $X if it breaks support.",
      "rationale",
      undefined,
      KNOWN([]),
    );
    expect(hits).toHaveLength(0);
  });
});

// ─── findGaps ────────────────────────────────────────────────────────────────

describe("findGaps", () => {
  it("returns empty when every narrated action has a matching tool event", () => {
    const hits = detectNarrationHits(
      "$ALB closed at the target as planned.",
      "rationale",
      undefined,
      KNOWN(["ALB"]),
    );
    const events: ToolCallEvent[] = [{ type: "position_closed", symbol: "ALB" }];
    expect(findGaps(hits, events)).toHaveLength(0);
  });

  it("flags narrated close with no tool call", () => {
    const hits = detectNarrationHits(
      "$INTC closed due to overextension",
      "rationale",
      undefined,
      KNOWN(["INTC"]),
    );
    const gaps = findGaps(hits, []);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      ticker: "INTC",
      expectedTool: "close_position",
    });
  });

  it("close_position narration is satisfied by a manage_position event (full scale-out)", () => {
    const hits = detectNarrationHits(
      "$NVDA closed at the gap-fill",
      "rationale",
      undefined,
      KNOWN(["NVDA"]),
    );
    const events: ToolCallEvent[] = [{ type: "position_modified", symbol: "NVDA" }];
    expect(findGaps(hits, events)).toHaveLength(0);
  });

  it("manage_position narration is satisfied by a position_closed event", () => {
    const hits = detectNarrationHits(
      "Trimmed $AVGO 50%",
      "rationale",
      undefined,
      KNOWN(["AVGO"]),
    );
    const events: ToolCallEvent[] = [{ type: "position_closed", symbol: "AVGO" }];
    expect(findGaps(hits, events)).toHaveLength(0);
  });

  it("dedupes same (ticker, expectedTool) pair across multiple verb hits", () => {
    const hits = detectNarrationHits(
      "Trimmed $MU 25%, then trimmed another 25%, then scaled out of the rest.",
      "rationale",
      undefined,
      KNOWN(["MU"]),
    );
    const gaps = findGaps(hits, []);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].ticker).toBe("MU");
  });

  it("matches symbol case-insensitively against tool events", () => {
    const hits = detectNarrationHits(
      "$intc closed",
      "rationale",
      undefined,
      KNOWN(["INTC"]),
    );
    const events: ToolCallEvent[] = [{ type: "position_closed", symbol: "intc" }];
    expect(findGaps(hits, events)).toHaveLength(0);
  });

  it("catches the 5/07 ROTATE rationale gaps end-to-end", () => {
    // Real text from runId=cmovfq790006904l8bio4izjv on 2026-05-07.
    // Status was COMPLETE despite zero tool calls firing for any of these.
    // 2026-05-13 update (GAPS P0-8): \badjusted\b now requires a
    // position-management noun (stop/trail/size/qty/position). The original
    // "MU adjusted with ongoing demand validation" no longer triggers a
    // manage_position gap — that prose is correctly an update_thesis
    // adjustment, not a position adjustment. To preserve the regression-
    // test intent, swap MU's verb to "MU's stop adjusted" so the
    // manage_position-flavored gap still fires for the MU clause.
    const text =
      "Added $AMD and $ASML as new positions with strong signals based on recent earnings. " +
      "Attempted updates to $AVGO, $TSM blocked due to entry conditions met without trading. " +
      "MU's stop adjusted with ongoing demand validation, $INTC closed due to overextension, " +
      "$QCOM invalidated due to weak performance and competition.";
    const known = KNOWN(["AMD", "ASML", "AVGO", "TSM", "MU", "INTC", "QCOM"]);
    const hits = detectNarrationHits(text, "rationale", undefined, known);
    const gaps = findGaps(hits, []); // zero tool events fired

    const closeIntc = gaps.find((g) => g.ticker === "INTC" && g.expectedTool === "close_position");
    const adjustMu = gaps.find((g) => g.ticker === "MU" && g.expectedTool === "manage_position");
    expect(closeIntc).toBeDefined();
    expect(adjustMu).toBeDefined();
  });

  it("does NOT flag 'adjusted' for thesis-state adjustments (GAPS P0-8)", () => {
    // 2026-05-13 EV Catalyst Event Trader failed when "Adjusted target based
    // on strategic expansion" matched the old bare \badjusted\b regex and
    // demanded a manage_position call. Adjusting a thesis target is
    // update_thesis territory, not manage_position. Verify the tightened
    // regex no longer fires on these patterns.
    const cases = [
      "Adjusted target based on strategic expansion.",
      "Adjusted thesis to reflect new sector reality.",
      "Adjusted my outlook on TSLA.",
      "Adjusted the plan to wait for confirmation.",
    ];
    const known = KNOWN(["TSLA", "AMD"]);
    for (const text of cases) {
      const hits = detectNarrationHits(text, "rationale", "TSLA", known);
      const adjustHits = hits.filter((h) => h.expectedTool === "manage_position");
      expect(adjustHits).toHaveLength(0);
    }
  });

  it("STILL flags 'adjusted' when followed by a position-management noun", () => {
    // Defense-in-depth: confirm we didn't over-tighten. These should still
    // fire because they're real manage_position actions.
    const cases = [
      { text: "Adjusted the stop on $MU to $640.", expectGap: true },
      { text: "$AMD position adjusted (trim to 50%).", expectGap: true },
      { text: "Trailing stop adjusted on $TSLA.", expectGap: true },
      { text: "Adjusted size on $NVDA from 100 to 50 shares.", expectGap: true },
    ];
    const known = KNOWN(["MU", "AMD", "TSLA", "NVDA"]);
    for (const { text } of cases) {
      const hits = detectNarrationHits(text, "rationale", undefined, known);
      const adjustHits = hits.filter((h) => h.expectedTool === "manage_position");
      expect(adjustHits.length).toBeGreaterThan(0);
    }
  });

  it("does not flag when complete tool coverage exists for the run", () => {
    const text = "$MU adjusted (raised stop to $640), $INTC closed at $52.";
    const known = KNOWN(["MU", "INTC"]);
    const hits = detectNarrationHits(text, "rationale", undefined, known);
    const events: ToolCallEvent[] = [
      { type: "position_modified", symbol: "MU" },
      { type: "position_closed", symbol: "INTC" },
    ];
    expect(findGaps(hits, events)).toHaveLength(0);
  });
});
