/**
 * activity-feed.test.ts — one list, the newest 8 of it, read the same way by
 * the Overview and the agent. From GEV's real rows, 2026-10-27 to 10-29
 * (Secular Compounder): three sale proposals, three trigger-run notes, four
 * fires and the expiry job's lines, as stored. Text cut to its opening.
 */
import { activityFeed, proposalSteps, recentItems, RECENT_ITEMS, type ProposalOrder, type StoredLine } from "./activity-feed";
import { saidBlock, unansweredWord } from "@/lib/agent/stock-context";

const at = (iso: string) => new Date(iso);
const run = (id: string, mode = "INTRADAY_TACTICAL") => ({ runId: id, run: { mode } });
const TRAIL = "bd941c67-a53a-41b8-918f-d303ec3b5e66";

const ORDERS: ProposalOrder[] = [
  // Tue 10-29 09:45:49 ET: proposed by the trigger run, still waiting.
  { id: "cmvtlj7h8000o07jtr5hif67i", status: "AWAITING_APPROVAL", intent: "CLOSE", side: "SELL", quantity: 9, symbol: "GEV", rationale: "GE Vernova is trading around $883 on Oct. 29 after third-quarter results beat expectations", rejectionMessage: null, expiresAt: at("2026-10-30T13:45:49.709Z"), alpacaConfirmedAt: null, filledPrice: null, createdAt: at("2026-10-29T13:45:49.709Z"), updatedAt: at("2026-10-29T13:45:49.709Z"), positionId: "pos-gev" },
  // Mon 10-28 09:40:58 ET: proposed, left to lapse a day later.
  { id: "cmvs5x4e5000s07lhq48zqebz", status: "EXPIRED", intent: "CLOSE", side: "SELL", quantity: 9, symbol: "GEV", rationale: "GE Vernova is at $848.12 on Oct. 28, still below both the $868 September base low", rejectionMessage: null, expiresAt: at("2026-10-29T13:40:58.850Z"), alpacaConfirmedAt: null, filledPrice: null, createdAt: at("2026-10-28T13:40:58.850Z"), updatedAt: at("2026-10-29T14:01:16.000Z"), positionId: "pos-gev" },
  { id: "cmvqqac8u000b08ijuvnpnrb3", status: "EXPIRED", intent: "CLOSE", side: "SELL", quantity: 9, symbol: "GEV", rationale: "GE Vernova is at $875.47 this morning, still well below the $987.31 line", rejectionMessage: null, expiresAt: at("2026-10-28T13:35:35.533Z"), alpacaConfirmedAt: null, filledPrice: null, createdAt: at("2026-10-27T13:35:35.533Z"), updatedAt: at("2026-10-28T14:00:58.000Z"), positionId: "pos-gev" },
];

const expiredCopy = (orderId: string) => ({ proposal: { from: { orderId, status: "AWAITING_APPROVAL" }, to: { orderId, status: "EXPIRED" } } });

const UPDATES: StoredLine[] = [
  // The expiry job's saved copies: the first two are covered by their orders' steps, the third names no order the feed holds.
  { id: "cmvtm32gx001807jtx0nhcii4", type: "PROPOSAL_EXPIRED", timestamp: at("2026-10-29T14:01:16.353Z"), summary: "CLOSE proposal on GEV expired without user decision", rationale: "The sale of 9 GEV expired without an answer.", fieldChanges: expiredCopy("cmvs5x4e5000s07lhq48zqebz") },
  { id: "cmvtlv8fv000z07jtgj1pt6hg", type: "TRIGGER_FIRED", timestamp: at("2026-10-29T13:55:10.843Z"), triggerId: "06506e39-522f-4ad1-aa62-d7fe10bf7003", priceAtTime: 889.055, summary: "Review if below 15% from the high since we bought", rationale: null },
  { id: "cmvtljbyt000u07jtwe1op938", type: "REVIEWED", timestamp: at("2026-10-29T13:45:55.541Z"), triggerId: TRAIL, priceAtTime: 881.14, summary: "Reviewed GEV thesis — no changes", rationale: "GE Vernova is around $883 on Oct. 29 after reporting a strong quarter", ...run("cmvtlisse000k07jtcm2d5e72") },
  { id: "cmvtlitlc000308l5t8msme4t", type: "TRIGGER_FIRED", timestamp: at("2026-10-29T13:45:31.728Z"), triggerId: TRAIL, priceAtTime: 882.71, summary: "Sell if below 6% from the high since we bought", rationale: null, ...run("cmvtlisse000k07jtcm2d5e72") },
  { id: "cmvsfpzci000208l10mo0s5jr", type: "TRIGGER_FIRED", timestamp: at("2026-10-28T18:15:21.906Z"), triggerId: "cf39ff35-5a15-43d4-a0f1-911cb5fd519b", priceAtTime: 884.8332, summary: "Review if below the 200-day average", rationale: "200-day $941.20; price $884.83 (−6.0% from it)" },
  { id: "cmvs6mu59000608l601o6wm90", type: "PROPOSAL_EXPIRED", timestamp: at("2026-10-28T14:00:58.653Z"), summary: "CLOSE proposal on GEV expired without user decision", rationale: "The sale of 9 GEV expired without an answer.", fieldChanges: expiredCopy("cmvqqac8u000b08ijuvnpnrb3") },
  { id: "cmvs5xab6000x07lhxdh577tr", type: "REVIEWED", timestamp: at("2026-10-28T13:41:06.546Z"), triggerId: "8861139d-9300-438c-9903-0aac1e68cc1b", priceAtTime: 841.26, summary: "Reviewed GEV thesis — no changes", rationale: "GE Vernova is at $848.12 on Oct. 28, so the stock is still below the $868 September base low", ...run("cmvs5wied000g07lhe4g9iz6j") },
  { id: "cmvs5wxyn000n07lhrwg6r637", type: "REVIEWED", timestamp: at("2026-10-28T13:40:50.543Z"), triggerId: "8861139d-9300-438c-9903-0aac1e68cc1b", priceAtTime: 843.48, summary: "Reviewed GEV thesis — no changes", rationale: "GE Vernova is at $848.12 this morning, so it is still below the $868 September base low", ...run("cmvs5wied000g07lhe4g9iz6j") },
  { id: "cmvs5wijs000i07lhhx29a9wv", type: "TRIGGER_FIRED", timestamp: at("2026-10-28T13:40:30.568Z"), triggerId: "8861139d-9300-438c-9903-0aac1e68cc1b", priceAtTime: 848.6, summary: "Sell if below $868", rationale: null, ...run("cmvs5wied000g07lhe4g9iz6j") },
  { id: "cmvs5wfod000008js5brxrt38", type: "TRIGGER_FIRED", timestamp: at("2026-10-28T13:40:26.845Z"), triggerId: "ae04d898-9865-42c5-885b-0107dac18a49", priceAtTime: 848.6, summary: "Review if below $850", rationale: null },
  { id: "cmvqr7261000608kxpqzjah67", type: "PROPOSAL_EXPIRED", timestamp: at("2026-10-27T14:01:02.137Z"), summary: "CLOSE proposal on GEV expired without user decision", rationale: "The sale of 9 GEV expired without an answer." },
  { id: "cmvqqakn4000l08ijrhqnv7tn", type: "REVIEWED", timestamp: at("2026-10-27T13:35:46.432Z"), triggerId: TRAIL, priceAtTime: 874.815, summary: "Reviewed GEV thesis — no changes", rationale: "GE Vernova is at $875.47 on Oct. 27, still below the $987.31 line", ...run("cmvqq9wvi000608ij5j1fvanr") },
  { id: "cmvqn1k41000z08l0urq42l27", type: "UPDATED", timestamp: at("2026-10-27T12:04:46.992Z"), priceAtTime: 855.12, summary: "Updated GEV thesis", rationale: "GE Vernova closed at $855.12 on Oct. 26, up 4.9% on the day", ...run("cmvqn0syi000y08l0jann683z", "MORNING_PLAN") },
];

const feed = activityFeed({ updates: UPDATES, orders: ORDERS });

describe("one list: the saved lines and each proposal's steps, newest first", () => {
  it("a proposal is its own steps, from the order; the expiry job's copies of them are dropped", () => {
    expect(feed.map((i) => i.id)).toEqual([
      "cmvtlv8fv000z07jtgj1pt6hg",
      "cmvtljbyt000u07jtwe1op938",
      "order:cmvtlj7h8000o07jtr5hif67i:proposed",
      "cmvtlitlc000308l5t8msme4t",
      "order:cmvs5x4e5000s07lhq48zqebz:expired",
      "cmvsfpzci000208l10mo0s5jr",
      "cmvs5xab6000x07lhxdh577tr",
      "order:cmvs5x4e5000s07lhq48zqebz:proposed",
      "cmvs5wxyn000n07lhrwg6r637",
      "cmvs5wijs000i07lhhx29a9wv",
      "cmvs5wfod000008js5brxrt38",
      "order:cmvqqac8u000b08ijuvnpnrb3:expired",
      "cmvqr7261000608kxpqzjah67",
      "cmvqqakn4000l08ijrhqnv7tn",
      "order:cmvqqac8u000b08ijuvnpnrb3:proposed",
      "cmvqn1k41000z08l0urq42l27",
    ]);
  });

  it("the paragraph lives on the Proposed step; Expired has a title and nothing else", () => {
    const [proposed, expired] = proposalSteps(ORDERS[1]);
    expect(proposed).toMatchObject({ type: "PROPOSAL_PROPOSED", rationale: "GE Vernova is at $848.12 on Oct. 28, still below both the $868 September base low" });
    expect(expired).toMatchObject({ type: "PROPOSAL_EXPIRED", rationale: null, timestamp: at("2026-10-29T13:40:58.850Z") });
    expect(proposalSteps(ORDERS[0]).map((s) => s.type)).toEqual(["PROPOSAL_PROPOSED"]);
  });

  it("a declined proposal's step carries your comment, never the proposal's reason again", () => {
    const [, declined] = proposalSteps({ ...ORDERS[1], status: "REJECTED", rejectionMessage: "Holding into the report." });
    expect(declined).toMatchObject({ type: "PROPOSAL_REJECTED", rationale: "Holding into the report." });
    const [, bare] = proposalSteps({ ...ORDERS[1], status: "REJECTED" });
    expect(bare.rationale).toBeNull();
  });
});

describe("the newest 8: what the Overview shows and the next run reads", () => {
  it("GEV on the night of 10-29: the 15% review, today's note and sale, yesterday's lapse, the 200-day review, yesterday's two notes and sale", () => {
    expect(recentItems(feed).map((i) => i.id)).toEqual(feed.slice(0, RECENT_ITEMS).map((i) => i.id));
    expect(recentItems(feed)).toHaveLength(8);
  });

  it("the agent's block is those 8 lines as the owner sees them, titles and paragraphs whole, newest first", () => {
    const text = saidBlock("GEV", feed)!;
    const lines = text.split("\n");
    expect(lines[0]).toBe("WHAT'S BEEN SAID ON $GEV — its newest 8 Activity lines, newest first, as the owner sees them:");
    expect(lines).toHaveLength(10);
    expect(lines[1]).toMatch(/^ {2}10-29 09:55 · \$889\.0[56] · Trigger: Review if below 15% from the high since we bought$/);
    expect(lines[2]).toBe('  10-29 09:45 · $881.14 · Reviewed no changes — "GE Vernova is around $883 on Oct. 29 after reporting a strong quarter"');
    expect(lines[3]).toBe('  10-29 09:45 · Proposed sell 9 shares — awaiting your review — "GE Vernova is trading around $883 on Oct. 29 after third-quarter results beat expectations"');
    expect(lines[4]).toBe("  10-29 09:45 · $882.71 · Trigger: Sell if below 6% from the high since we bought");
    expect(lines[5]).toBe("  10-29 09:40 · Expired sell 9 shares — no decision");
    expect(lines[6]).toBe('  10-28 14:15 · $884.83 · Trigger: Review if below the 200-day average — "200-day $941.20; price $884.83 (−6.0% from it)"');
    expect(lines[9]).toBe('Full history: get_theses(tickers: ["GEV"], include_history: true)');
    // Nothing older than the 8 and nothing the expiry job stitched.
    expect(text).not.toContain("Oct. 27");
    expect(text).not.toContain("expired without an answer");
  });

  it("nothing of the owner's waits for an answer on GEV: a lapse decides nothing", () => {
    expect(unansweredWord(feed)).toBeNull();
  });

  it("an empty feed is no block; one line is the header, the line and the way to the rest", () => {
    expect(saidBlock("X", [])).toBeNull();
    const one = activityFeed({ updates: [UPDATES[2]], orders: [] });
    expect(saidBlock("GEV", one)!.split("\n")).toHaveLength(3);
    expect(saidBlock("GEV", one)).toContain("its newest 1 Activity lines");
  });
});
