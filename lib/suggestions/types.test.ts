import {
  buildDedupeKey,
  proposedDiffSchema,
  suggestionBatchSchema,
  type ProposedDiff,
} from "./types";

describe("buildDedupeKey", () => {
  // Dedup strategy pins the "one PENDING per (kind + target)" invariant the
  // weekly Inngest job relies on to skip re-emitting the same proposal.

  it("dedupes PROMPT_EDIT on kind alone (one outstanding prompt-edit)", () => {
    const a: ProposedDiff = {
      kind: "PROMPT_EDIT",
      nextAnalystPrompt: "a".repeat(50),
      summary: "tighten stop rules",
    };
    const b: ProposedDiff = {
      kind: "PROMPT_EDIT",
      nextAnalystPrompt: "b".repeat(50),
      summary: "something else",
    };
    expect(buildDedupeKey("PROMPT_EDIT", a)).toBe("PROMPT_EDIT");
    expect(buildDedupeKey("PROMPT_EDIT", b)).toBe("PROMPT_EDIT");
  });

  it("dedupes META_COMMENTARY on kind alone", () => {
    const diff: ProposedDiff = {
      kind: "META_COMMENTARY",
      note: "You've been flagging $NVDA 3 runs without acting.",
    };
    expect(buildDedupeKey("META_COMMENTARY", diff)).toBe("META_COMMENTARY");
  });

  it("dedupes watchlist add/remove on uppercased ticker", () => {
    const addUpper: ProposedDiff = { kind: "WATCHLIST_ADD", ticker: "NVDA" };
    const addLower: ProposedDiff = { kind: "WATCHLIST_ADD", ticker: "nvda" as unknown as "NVDA" };
    expect(buildDedupeKey("WATCHLIST_ADD", addUpper)).toBe("WATCHLIST_ADD:NVDA");
    expect(buildDedupeKey("WATCHLIST_ADD", addLower)).toBe("WATCHLIST_ADD:NVDA");
    const remove: ProposedDiff = { kind: "WATCHLIST_REMOVE", ticker: "NVDA" };
    expect(buildDedupeKey("WATCHLIST_REMOVE", remove)).toBe("WATCHLIST_REMOVE:NVDA");
    expect(buildDedupeKey("WATCHLIST_ADD", addUpper)).not.toBe(buildDedupeKey("WATCHLIST_REMOVE", remove));
  });

  it("dedupes exclusion add on uppercased ticker", () => {
    const diff: ProposedDiff = { kind: "EXCLUSION_ADD", ticker: "XYZ" };
    expect(buildDedupeKey("EXCLUSION_ADD", diff)).toBe("EXCLUSION_ADD:XYZ");
  });

  it("dedupes universe sector operations on sector name", () => {
    const add: ProposedDiff = {
      kind: "UNIVERSE_ADD_SECTOR",
      sector: "Information Technology",
    };
    expect(buildDedupeKey("UNIVERSE_ADD_SECTOR", add)).toBe(
      "UNIVERSE_ADD_SECTOR:Information Technology",
    );
    const remove: ProposedDiff = {
      kind: "UNIVERSE_REMOVE_SECTOR",
      sector: "Energy",
    };
    expect(buildDedupeKey("UNIVERSE_REMOVE_SECTOR", remove)).toBe(
      "UNIVERSE_REMOVE_SECTOR:Energy",
    );
  });

  it("dedupes intelligence query add on query text (lowercased, trimmed)", () => {
    const a: ProposedDiff = {
      kind: "INTELLIGENCE_QUERY_ADD",
      query: "  Fed rate decision reaction  ",
      category: "THEMATIC",
    };
    const b: ProposedDiff = {
      kind: "INTELLIGENCE_QUERY_ADD",
      query: "fed rate decision reaction",
      category: "EVENT",
    };
    expect(buildDedupeKey("INTELLIGENCE_QUERY_ADD", a)).toBe(
      buildDedupeKey("INTELLIGENCE_QUERY_ADD", b),
    );
  });

  it("dedupes intelligence query remove on monitor ID", () => {
    const diff: ProposedDiff = {
      kind: "INTELLIGENCE_QUERY_REMOVE",
      monitorId: "mon_abc123",
      queryText: "stale query",
    };
    expect(buildDedupeKey("INTELLIGENCE_QUERY_REMOVE", diff)).toBe(
      "INTELLIGENCE_QUERY_REMOVE:mon_abc123",
    );
  });

  it("distinguishes ADD vs REMOVE for same target", () => {
    const add: ProposedDiff = { kind: "WATCHLIST_ADD", ticker: "NVDA" };
    const remove: ProposedDiff = { kind: "WATCHLIST_REMOVE", ticker: "NVDA" };
    expect(buildDedupeKey("WATCHLIST_ADD", add)).not.toBe(
      buildDedupeKey("WATCHLIST_REMOVE", remove),
    );
  });
});

describe("proposedDiffSchema validation", () => {
  // The agent returns structured output that must be validated before we
  // persist. These cases pin the "bad data is dropped" guarantee.

  it("rejects lowercase tickers", () => {
    const result = proposedDiffSchema.safeParse({
      kind: "WATCHLIST_ADD",
      ticker: "nvda",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-GICS sectors", () => {
    const result = proposedDiffSchema.safeParse({
      kind: "UNIVERSE_ADD_SECTOR",
      sector: "Tech", // not a GICS canonical value
    });
    expect(result.success).toBe(false);
  });

  it("accepts canonical GICS sectors", () => {
    const result = proposedDiffSchema.safeParse({
      kind: "UNIVERSE_ADD_SECTOR",
      sector: "Information Technology",
    });
    expect(result.success).toBe(true);
  });

  it("rejects PROMPT_EDIT with too-short text", () => {
    const result = proposedDiffSchema.safeParse({
      kind: "PROMPT_EDIT",
      nextAnalystPrompt: "short",
      summary: "a valid summary is long enough",
    });
    expect(result.success).toBe(false);
  });

  it("rejects INTELLIGENCE_QUERY_ADD with TICKER category", () => {
    // Per-ticker queries duplicate portfolio-watchlist-monitor — schema must
    // block this so the prompt rule is enforced structurally too.
    const result = proposedDiffSchema.safeParse({
      kind: "INTELLIGENCE_QUERY_ADD",
      query: "news about $NVDA",
      category: "TICKER",
    });
    expect(result.success).toBe(false);
  });

  it("accepts thematic, sector, event, market intelligence queries", () => {
    for (const category of ["THEMATIC", "SECTOR", "EVENT", "MARKET"] as const) {
      const result = proposedDiffSchema.safeParse({
        kind: "INTELLIGENCE_QUERY_ADD",
        query: "Fed rate decision reaction and sector-level implications",
        category,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("suggestionBatchSchema", () => {
  it("accepts an empty suggestions array (the 'nothing to propose' case)", () => {
    const result = suggestionBatchSchema.safeParse({ suggestions: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a batch larger than 10 suggestions", () => {
    const one = {
      title: "Add $XYZ to exclusion list",
      rationale:
        "Three consecutive losses in the last 14 days total -$515 realized. Every setup was a momentum long, all stopped out within 2 days.",
      sourceRunId: "",
      evidence: {
        patternSummary: "3 consecutive losses on XYZ",
        runIds: [],
        tradeIds: [],
        briefingIds: [],
        dataPoints: ["XYZ LOSS -$180", "XYZ LOSS -$240", "XYZ LOSS -$95"],
      },
      proposedDiff: {
        kind: "EXCLUSION_ADD" as const,
        ticker: "XYZ",
      },
    };
    const result = suggestionBatchSchema.safeParse({
      suggestions: new Array(11).fill(one),
    });
    expect(result.success).toBe(false);
  });
});
