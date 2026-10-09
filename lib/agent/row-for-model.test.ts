/**
 * row-for-model.test.ts — the one builder (Roadmap step 8): a quiet stock is
 * one line, a stock in a situation the short row, the full row by ticker or
 * by rule. Each line explains itself; the screen's source tags are stripped;
 * a line with nothing to say is left out. Built from one saved-row fixture
 * shaped like a real held row, written inline (no fixture file).
 */
import { rowForModel, sizeFor, stripSourceTags, FULL_ROW_SITUATIONS } from "@/lib/agent/row-for-model";

type Row = Record<string, unknown>;

/** A held stock whose floor fired, as get_theses saves it (dates as the saved thread holds them: ISO strings). */
const held = (): Row => ({
  id: "t_iot",
  ticker: "IOT",
  direction: "LONG",
  status: "HOLDING",
  horizon: "TARGET",
  setupId: "PEAD",
  conviction: "HIGH",
  coreBelief: "IOT drifts to $47 within 60 days. [STRUCTURED:Earnings History]",
  keyAssumptions: ["ARR customers grow 38% [WEB:https://example.com/a]", "Revisions continue up"],
  invalidationConds: ["A close below $36.50 on volume", "Q3 ARR under $120M"],
  snapshot: { text: "**First sentence** of the picture [STRUCTURED:Snapshot]. Second sentence says more. Third sentence goes on for a good while longer than the others to push the whole text well past three hundred characters, so that the short row has to stop at a sentence boundary, as the rule says, instead of cutting a word in half somewhere in the middle of this very long sentence. Fourth sentence.", citations: [] },
  bullCase: { bullets: [{ text: "**Clean beat:** EPS +25% [STRUCTURED:Earnings History]" }, { text: "Upgrades [WEB:https://example.com/b]" }] },
  bearCase: { bullets: [{ text: "FCF margin guided lower" }] },
  entryPrice: 39.55,
  targetPrice: 47,
  stopLoss: 40.8,
  catalystDate: "2026-10-29T00:00:00.000Z",
  scoring: { composite: 8, entryQuality: { score: 2, note: "pullback to the 50-day" }, trendStrength: { score: 2, note: "above the 200-day" }, relativeStrength: { score: 2, note: "leads SPY" }, catalystFreshness: { score: 2, note: "reported 10 days ago" } },
  convictionRationale: "All four signals clean [STRUCTURED:Earnings History].",
  variantView: "Consensus sees deceleration; I see the ARR cohort.",
  researchUpdatedAt: "2026-10-05T13:35:48.491Z",
  researchPriceThen: 39.55,
  researchAge: { daysOld: 2, freshness: "fresh", horizonThreshold: 30 },
  context: "WHAT'S BEEN SAID ON $IOT\nLast look: morning run, 10-06 08:00.",
  triggers: [
    { id: "t_floor", says: "Sell if below $40.80", rationale: "Under the breakout shelf.", firesDirectly: true, cooldownDays: 1, lastFiredAt: "2026-10-07T14:40:15.751Z", setBy: "AGENT" },
    { id: "t_target", says: "Review if above $47", rationale: "The objective.", cooldownDays: 1, setBy: "PRINCIPAL" },
  ],
  inheritedTriggers: [
    { id: "a_trail", says: "Sell if 12% below the high since we bought", rationale: "Protect the gain.", level: "ANALYST" },
    { id: "acct_filing", says: "Review if it files something material with the SEC", rationale: "Read the filing first.", level: "ACCOUNT", lastFiredAt: "2026-10-01T13:00:00.000Z" },
  ],
  triggerCount: 4,
  needsAction: { kind: "TRIGGER_FIRED", triggerId: "t_floor", action: "EXIT", repeatLine: "This sale has fired 3 days running." },
  situations: ["PROTECTIVE_SALE", "REVIEW_DUE"],
  resolved: {
    currentPrice: 40.51, unrealizedGainPct: 3.7, progressToTarget: 0.18,
    ladderHealth: { gainPct: 3.7, floor: { triggerId: "t_floor", price: 40.8, flooredGainPct: 4.45, isTrail: false, label: "below $40.80" }, flooredGainPct: 4.45, hasTrail: false, nearestRung: { triggerId: "t_target", action: "REVIEW", price: 47, distancePct: 16.0, label: "above $47" }, daysSinceLadderEdit: 1, isUnprotectedGain: false, summary: "+3.7% from entry ($39.06 → $40.51); floor locks +4.4% — below $40.80; no trail; next rung REVIEW above $47 @ $47.00 (+16.0% away); ladder last edited 1d ago" },
    planSanity: null, floorRisk: null, triggerState: "EXIT_FIRED", triggerDetail: "below $40.80 (now $40.51)", actionability: "ACTIVE_HOLD", supersededBy: null, staleness: "FRESH", resolvedAt: "2026-10-07T20:30:00.000Z", quoteAgeMs: 0,
  },
  setup: { id: "PEAD", name: "Post-earnings drift", failureSigns: ["The gap-day low breaks", "Revisions don't follow"], manage: "After +10%: 3 ATR under the high.", time: "Hold 30–60 days.", partialAtR: 2, beatAndFadeReview: true },
  nameTheSetup: null,
  buyBlockedByFull: null,
  heldThroughFloor: null,
  unapprovedExitCount: 0,
  history: [{ id: "u1", type: "REVIEWED" }],
  position: { quantity: 300, avgCost: 39.062, openedAt: "2026-10-01T17:28:24.000Z", peakPrice: 42.845 },
  proposals: [{ id: "o1", side: "SELL", intent: "CLOSE", quantity: 300, createdAt: "2026-10-07T14:40:00.000Z", expiresAt: "2026-10-08T14:40:00.000Z" }],
  price: { current: 40.51, dayChangePct: -0.74, asOf: "2026-10-07T20:00:00.000Z" },
  chart: { asOf: "2026-10-07", sma20: 39.7, sma50: 39.47, sma200: 33.68, rsi14: 56, move5dPct: 2.1, move20dPct: 6.4, high20: 44.21, low20: 36.4, high52w: 47.47, low52w: 20.1, volumeAvg20: 5_696_040, atr14: 1.99, rsVsSpy1M: -0.6, rsVsSpy3M: 6.1 },
});

/** A quiet watched stock as get_theses saves it. */
const quiet = (): Row => ({
  id: "t_docu", ticker: "DOCU", status: "WATCHING", direction: "LONG", horizon: "TARGET", setupId: "PEAD", conviction: "MEDIUM", composite: 8,
  coreBelief: "A long belief that the line leaves out.", entryPrice: 74.1, targetPrice: 83, stopLoss: 68.9, currentPrice: 70.03,
  reviewDueAt: "2026-10-20T12:00:00.000Z", catalystDate: null, triggerCount: 6, researchAge: { daysOld: 9 }, resolvedActionability: "WAIT_FOR_TRIGGER", needsAction: null, situations: [],
});

describe("the size a row gets", () => {
  it("is the full row for a named read, by rule for a woken watch or an unnamed setup, the short row otherwise", () => {
    expect(sizeFor(held(), true)).toBe("full");
    expect(sizeFor(held(), false)).toBe("short");
    for (const code of FULL_ROW_SITUATIONS) expect(sizeFor({ ...held(), situations: ["REVIEW_DUE", code] }, false)).toBe("full");
  });
});

describe("the one line", () => {
  it("is the stock and its stance, the price, the plan levels, the next review, the score and the id", () => {
    expect(rowForModel(quiet(), { named: false, size: "line" })).toBe(
      "DOCU · watch · LONG · PEAD · $70.03 · buy $74.10 · target $83.00 · floor $68.90 · review 10-20 · score 8 · id t_docu",
    );
  });
  it("leaves out what a stock lacks, says no view on a seed, and names the horizon when no setup is named", () => {
    expect(rowForModel({ id: "t_x", ticker: "XYZ", status: "WATCHING", direction: null, horizon: "CATALYST", catalystDate: "2026-11-02T00:00:00.000Z" }, { named: false, size: "line" })).toBe(
      "XYZ · watch · no view · CATALYST · catalyst 2026-11-02 · id t_x",
    );
  });
});

describe("the short row", () => {
  const row = rowForModel(held(), { named: false, size: "short" }) as Row;

  it("has the keys in reading order and nothing that is empty", () => {
    expect(Object.keys(row)).toEqual([
      "stock", "id", "situations", "said", "position", "proposal_waiting", "price", "plan", "protection", "triggers",
      "belief", "assumptions", "would_prove_it_wrong", "setup", "snapshot", "score", "chart", "research", "catalyst", "repeat",
    ]);
  });

  it("writes each line with its units", () => {
    expect(row.stock).toBe("IOT · held · LONG · PEAD · conviction HIGH");
    expect(row.situations).toEqual(["PROTECTIVE_SALE (sale signal)", "REVIEW_DUE (review due)"]);
    expect(row.said).toMatch(/^WHAT'S BEEN SAID ON \$IOT/);
    expect(row.position).toBe("300 sh at $39.06 → $40.51 (+3.7%), $12,153; opened 10-01; high since we bought $42.85");
    expect(row.proposal_waiting).toBe("sell 300 sh, placed 10-07 10:40 ET, expires 10-08 10:40 ET");
    expect(row.price).toBe("$40.51, -0.7% today (10-07 16:00 ET)");
    expect(row.plan).toBe("entry $39.06 (filled) · target $47.00 · floor $40.80 · 18% of the way to the target");
    // The price is under the floor: the protection line says breached, in the summary's terms.
    expect(row.protection).toBe("floor $40.80 is breached (price $40.51, -0.7%); it would lock +4.5%; no trail; next rung REVIEW at $47.00 (+16.0% away); ladder last edited 1d ago");
    expect(row.triggers).toEqual([
      'Sell if below $40.80 · fired 10-07 10:40 ET · set by the agent · "Under the breakout shelf." [id t_floor]',
      'Review if above $47 · set by hand · "The objective." [id t_target]',
      "Sell if 12% below the high since we bought · inherited",
      'Review if it files something material with the SEC · inherited · fired 10-01 09:00 ET · "Read the filing first." [id acct_filing]',
    ]);
    expect(row.belief).toBe("IOT drifts to $47 within 60 days.");
    expect(row.assumptions).toEqual(["ARR customers grow 38%", "Revisions continue up"]);
    expect(row.would_prove_it_wrong).toEqual(["A close below $36.50 on volume", "Q3 ARR under $120M"]);
    expect(row.setup).toBe("PEAD, Post-earnings drift. Failure looks like: The gap-day low breaks; Revisions don't follow. Manage: After +10%: 3 ATR under the high. Time: Hold 30–60 days.");
    expect(row.score).toBe("8/10 (entry 2 · trend 2 · relative strength 2 · catalyst 2)");
    expect(row.chart).toBe("as of the 2026-10-07 close: 20d $39.70 · 50d $39.47 · 200d $33.68 · RSI 56 (14-day, from the closes and the live price) · 20d range $36.40–$44.21 · 52w high $47.47 · ATR $1.99 · vs the S&P 1M -0.6% / 3M +6.1% · 20d avg volume 5.7M · 5d +2.1% · 20d +6.4%");
    expect(row.research).toBe('Written 2026-10-05 at $39.55, 2 days ago. Full row: get_theses(tickers: ["IOT"]).');
    expect(row.catalyst).toBe("2026-10-29");
    expect(row.repeat).toBe("This sale has fired 3 days running.");
  });

  it("an inherited rule carries its id only once it has fired; the stock's own rules always do", () => {
    const lines = row.triggers as string[];
    const unfired = lines.find((l) => l.startsWith("Sell if 12% below the high"))!;
    const fired = lines.find((l) => l.startsWith("Review if it files"))!;
    expect(unfired).not.toContain("[id");
    expect(fired).toMatch(/\[id acct_filing\]$/);
    for (const own of lines.filter((l) => !l.includes("· inherited"))) expect(own).toMatch(/\[id t_\w+\]$/);
  });

  it("keeps the snapshot to whole sentences under 300 characters, tags and bold stripped", () => {
    const snap = String(row.snapshot);
    expect(snap).toBe("First sentence of the picture. Second sentence says more.");
    expect(snap.length).toBeLessThanOrEqual(300);
  });

  it("carries no research essays, no raw facts, no bookkeeping and no source tags", () => {
    for (const k of ["bull_case", "bear_case", "bullCase", "bearCase", "conviction_rationale", "variant_view", "score_notes", "resolved", "needsAction", "triggerState", "researchAge", "unapprovedExitCount", "history", "inheritedTriggers", "proposals", "coreBelief", "context"]) {
      expect(row).not.toHaveProperty(k);
    }
    expect(JSON.stringify(row)).not.toMatch(/\[(STRUCTURED|WEB)/);
    expect(JSON.stringify(row)).not.toContain("**");
  });

  it("notes the conviction rule on a LOW holding, the paper record on a promoted stock, a plan check and a floor risk when they exist", () => {
    const low = rowForModel({ ...held(), conviction: "LOW" }, { named: false, size: "short" }) as Row;
    expect(low.note).toBe("Conviction is LOW: tighten the floor on this review.");
    expect(row).not.toHaveProperty("note");
    const promoted = rowForModel({ ...held(), status: "PROMOTED", paperTenureDays: 41, paperRealizedPnl: 812.5, paperReviewCount: 3, position: null }, { named: false, size: "short" }) as Row;
    expect(promoted.paper_record).toBe("held 41 days on paper, realized $812.50, 3 reviews");
    expect(promoted).not.toHaveProperty("position");
    const checked = rowForModel(
      { ...held(), status: "WATCHING", position: null, resolved: { ...(held().resolved as Row), planSanity: [{ kind: "ENTRY_STALE", text: "The buy level $39.55 was set 30 days ago and hasn't filled." }], floorRisk: { line: "At the $40.80 floor, 300 shares lose $1,200 — 1.8% of the account." } } },
      { named: false, size: "short" },
    ) as Row;
    expect(checked.plan_checks).toEqual(["The buy level $39.55 was set 30 days ago and hasn't filled."]);
    expect(checked.floor_risk).toBe("At the $40.80 floor, 300 shares lose $1,200 — 1.8% of the account.");
    expect(checked.plan).toBe("buy $39.55 · target $47.00 · floor $40.80");
    expect(checked).not.toHaveProperty("protection");
  });
});

describe("the full row", () => {
  it("is the short row plus the cases, the conviction rationale, the variant view, the score notes, the whole snapshot and, on a named read, the history", () => {
    const row = rowForModel(held(), { named: true, size: "full" }) as Row;
    expect(row.bull_case).toEqual(["Clean beat: EPS +25%", "Upgrades"]);
    expect(row.bear_case).toEqual(["FCF margin guided lower"]);
    expect(row.conviction_rationale).toBe("All four signals clean.");
    expect(row.variant_view).toBe("Consensus sees deceleration; I see the ARR cohort.");
    expect(row.score_notes).toEqual({ entry: "pullback to the 50-day", trend: "above the 200-day", relative_strength: "leads SPY", catalyst: "reported 10 days ago" });
    expect(String(row.snapshot)).toMatch(/Fourth sentence\.$/);
    expect(row.research).toBe("Written 2026-10-05 at $39.55, 2 days ago.");
    expect(row.history).toEqual([{ id: "u1", type: "REVIEWED" }]);
    expect(Object.keys(row).indexOf("snapshot")).toBeLessThan(Object.keys(row).indexOf("score"));
    expect(Object.keys(row).indexOf("bull_case")).toBeLessThan(Object.keys(row).indexOf("chart"));
  });
  it("by rule, without a named read, carries no history", () => {
    const row = rowForModel({ ...held(), situations: ["NO_SETUP_NAMED"], nameTheSetup: { choose: [{ id: "PEAD", name: "Post-earnings drift", when: "after a beat" }] } }, { named: false, size: "full" }) as Row;
    expect(row).not.toHaveProperty("history");
    expect(row.nameTheSetup).toEqual({ choose: [{ id: "PEAD", name: "Post-earnings drift", when: "after a beat" }] });
    expect(row.bull_case).toBeDefined();
  });
});

/** The seven research sections in the three shapes the writer saves (IOT's, 2026-10-08): a paragraph with citations, cited bullets, plain text. */
const research = {
  recentCatalysts: { text: "Raised guidance on Sept 3 [WEB:https://example.com/r].", citations: [{ url: "https://example.com/r", kind: "WEB", domain: "example.com" }] },
  fundamentals: { text: "**Revenue +30%** year on year [STRUCTURED:Financials].", citations: [{ kind: "STRUCTURED", title: "Financials" }] },
  latestEarnings: { bullets: [{ text: "EPS beat by 25% [STRUCTURED:Earnings History]", citation: { kind: "STRUCTURED", title: "Earnings History" } }, { text: "Revenue beat by 5%" }] },
  catalystsAndEvents: { bullets: [{ text: "Q3 report in December [WEB:https://example.com/c]" }] },
  analystConsensus: { text: "Targets $51 to $58 [WEB:https://example.com/a].", citations: [] },
  insiderTechnical: { text: "No open-market buys in 90 days [STRUCTURED:Insider Activity].", citations: [] },
  researchData: "Raw notes [STRUCTURED:Snapshot] with numbers.",
};
const SECTIONS = Object.keys(research);

describe("the research sections a read loads with include_research", () => {
  it("the full row carries each under its own name, as text, with the citations and tags removed", () => {
    const row = rowForModel({ ...held(), ...research }, { named: true, size: "full" }) as Row;
    expect(row.recentCatalysts).toBe("Raised guidance on Sept 3.");
    expect(row.fundamentals).toBe("Revenue +30% year on year.");
    expect(row.latestEarnings).toEqual(["EPS beat by 25%", "Revenue beat by 5%"]);
    expect(row.catalystsAndEvents).toEqual(["Q3 report in December"]);
    expect(row.analystConsensus).toBe("Targets $51 to $58.");
    expect(row.insiderTechnical).toBe("No open-market buys in 90 days.");
    expect(row.researchData).toBe("Raw notes with numbers.");
    const text = JSON.stringify(SECTIONS.map((k) => row[k]));
    expect(text).not.toMatch(/\[(STRUCTURED|WEB)|citation|example\.com|\*\*/);
  });
  it("a full row without them carries none", () => {
    const row = rowForModel(held(), { named: true, size: "full" }) as Row;
    for (const k of SECTIONS) expect(row).not.toHaveProperty(k);
  });
  it("the short row never carries them, even when the row has them", () => {
    const row = rowForModel({ ...held(), ...research }, { named: false, size: "short" }) as Row;
    for (const k of SECTIONS) expect(row).not.toHaveProperty(k);
  });
});

describe("stripSourceTags", () => {
  it("removes the screen's citations and markdown bold and nothing else", () => {
    expect(stripSourceTags("**Bold:** a claim [STRUCTURED:Earnings History] [WEB:https://x.y/z] and more.")).toBe("Bold: a claim and more.");
  });
});
