/**
 * What every agent reads of a stock's Activity: one list, newest first, one
 * sentence per line, chosen by a filter (lib/agent/stock-context.ts): the last
 * 3 reviews, 3 news notes of medium or high impact, 3 of the owner's notes and
 * the last decline, from the last 45 days; no trigger
 * edits, no fires, no proposal steps without words. And a trigger the owner
 * set says when and what it was. Rows are IOT's and MU's as stored on
 * 2026-11-19 (__fixtures__/activity-read-iot-mu-2026-11-19.json says what was cut).
 */
import raw from "@/lib/agent/__fixtures__/activity-read-iot-mu-2026-11-19.json";
import { stockContextFor } from "@/lib/agent/stock-context-for";
import { ownerSets, READ, READ_DAYS } from "@/lib/agent/stock-context";
import { activityFeed, toFeedItem, type ProposalOrder, type StoredLine } from "@/lib/thesis/activity-feed";
import { rowForModel } from "@/lib/agent/row-for-model";
import { triggerForAgent } from "@/lib/agent/triggers/format";
import { noteLine, type SharedNoteRow } from "@/lib/agent/shared-notes";

type Stored = Omit<StoredLine, "timestamp"> & { timestamp: string };
const fx = raw as unknown as {
  iot: { ticker: string; readAt: string; updates: Stored[]; orders: Array<Record<string, unknown>> };
  mu: { triggers: Array<Parameters<typeof triggerForAgent>[0]>; updates: Stored[] };
};
const lines = (rows: Stored[]): StoredLine[] => rows.map((r) => ({ ...r, timestamp: new Date(r.timestamp), answers: null }));
const day = (v: unknown) => (typeof v === "string" ? new Date(v) : null);
const orders = fx.iot.orders.map((o) => ({ ...o, createdAt: day(o.createdAt), updatedAt: day(o.updatedAt), expiresAt: day(o.expiresAt), alpacaConfirmedAt: day(o.alpacaConfirmedAt) })) as unknown as ProposalOrder[];
const iot = (extra: StoredLine[] = []) => stockContextFor({ ticker: "IOT", rows: [...lines(fx.iot.updates), ...extra], orders, now: new Date(fx.iot.readAt) }).text!;
const body = (text: string) => text.split("\n").slice(1, -1);

const DECLINE = "Waiting two more days before I decide.";

describe("IOT's Activity as every agent reads it", () => {
  const text = iot();
  const list = body(text);

  it("is one list between a line that says the rule and the way to the rest", () => {
    expect(text.split("\n")[0]).toBe("Activity on $IOT in the last 45 days, newest first: the last 3 reviews, 3 news notes and 3 of your notes, and your last decline.");
    expect(text.split("\n").at(-1)).toBe('Full history: get_theses(tickers: ["IOT"], include_history: true)');
  });

  it("the last 3 reviews and the owner's decline, newest first, each the same sentence", () => {
    expect(list.map((l) => l.slice(0, l.indexOf(": ")))).toEqual([
      "  Review by its analyst, Nov 18, 8:01 AM at $39.27",
      "  Review by its analyst, Nov 17, 9:30 AM at $40.58",
      "  Declined sell 300 shares by you, Nov 16, 9:18 PM at $40.85",
      "  Review by the Writer, Nov 15, 9:08 PM at $41.36",
    ]);
    expect(list[0]).toMatch(/: weaker\. Samsara is still slipping ahead of its Dec\. 3 earnings report, .* before the report\. \[id cmwm4qsop000c08lb6ixxsdzj\]$/);
    expect(list[1]).toContain(": weaker. Samsara is slipping again to about $40.6");
    expect(list[2]).toBe(`  Declined sell 300 shares by you, Nov 16, 9:18 PM at $40.85: ${DECLINE}`);
    // The Writer's refresh carried no verdict, so none is said.
    expect(list[3]).toContain("at $41.36: Samsara is at $41.36, about 3% below the $42.70 stop");
  });

  it("the 11-18 review, saved on two lines by one run, is one review", () => {
    expect(fx.iot.updates.filter((u) => u.rationale?.startsWith("Samsara is still slipping ahead"))).toHaveLength(2);
    expect(text.split("Samsara is still slipping ahead")).toHaveLength(2);
  });

  it("the fires, the proposals' own steps and the reviews before the last three are not sent", () => {
    expect(READ).toEqual({ review: 3, news: 3, note: 3, decline: 1 });
    expect(list).toHaveLength(4);
    expect(text).not.toContain("Sell if below");
    expect(text).not.toContain("Proposed");
    expect(text).not.toContain("Expired");
    expect(text).not.toContain("Nov 13");
  });
});

describe("the filter, on lines added to IOT's", () => {
  const after = (iso: string, line: Partial<StoredLine>): StoredLine => ({ id: `x-${iso}`, type: "UPDATED", timestamp: new Date(iso), ...line });
  const news = (id: string, iso: string, over: Partial<SharedNoteRow> = {}): SharedNoteRow => ({
    id, author: "MARKET_REVIEWER", runId: "mr", body: `News ${id}.`, audience: "STOCKS", analystId: null, tickers: ["IOT"], eventDate: null, pinnedUntil: null,
    createdAt: new Date(iso), impact: "high", effect: "weaker", prices: { IOT: 38.9 }, ...over,
  });
  const text = iot([
    ...["n4", "n3", "n2", "n1"].map((id, k) => noteLine(news(id, `2026-11-19T12:3${4 - k}:00Z`), "IOT")),
    noteLine(news("mine", "2026-11-19T12:20:00Z", { author: "OWNER", impact: null, effect: null, body: "Sell before the report if it is still under $40." }), "IOT"),
    after("2026-11-18T15:00:00Z", { id: "fire", type: "TRIGGER_FIRED", summary: "Sell if below $42.70", rationale: "price $39.10", triggerId: "cf1e7fd0-8bcc-4629-b605-5d1da41735c2", priceAtTime: 39.1 }),
    after("2026-11-18T22:00:00Z", { summary: "You changed a trigger on IOT: Sell if below $40", rationale: "You changed this trigger.", fieldChanges: { source: { from: null, to: "USER" }, triggerOps: { from: null, to: [{ id: "cf1e7fd0-8bcc-4629-b605-5d1da41735c2", op: "edit", text: "Changed: Sell if below $42.70 → Sell if below $40" }] } } }),
    after("2026-11-18T21:00:00Z", { summary: "Updated IOT: Added: Review if above $45", rationale: "A level to look again at.", runId: "run-edit", runMode: "MORNING_PLAN", fieldChanges: { noNote: { from: null, to: true }, triggerOps: { from: null, to: [{ id: "t-new", op: "add", text: "Added: Review if above $45" }] } } }),
  ]);
  const list = body(text);

  it("up to 3 news notes, each with the Market Reviewer's two marks; the fourth is left out", () => {
    expect(list.filter((l) => l.startsWith("  News by the Market Reviewer"))).toEqual([
      "  News by the Market Reviewer, Nov 19, 7:34 AM at $38.90: high impact, weaker. News n4.",
      "  News by the Market Reviewer, Nov 19, 7:33 AM at $38.90: high impact, weaker. News n3.",
      "  News by the Market Reviewer, Nov 19, 7:32 AM at $38.90: high impact, weaker. News n2.",
    ]);
  });

  it("a low-impact news note is not read, and nothing older than 45 days is", () => {
    const low = iot([noteLine(news("low1", "2026-11-19T12:40:00Z", { impact: "low", effect: "neutral", body: "Background on the industry." }), "IOT")]);
    expect(low).not.toContain("Background on the industry.");
    expect(READ_DAYS).toBe(45);
    // Read on Jan 2, IOT's Nov 18 review is the 45th day back and the rest are older.
    const later = stockContextFor({ ticker: "IOT", rows: lines(fx.iot.updates), orders, now: new Date("2027-01-02T12:00:00Z") }).text!;
    expect(body(later).map((l) => l.slice(0, l.indexOf(": ")))).toEqual(["  Review by its analyst, Nov 18, 8:01 AM at $39.27"]);
    expect(stockContextFor({ ticker: "IOT", rows: lines(fx.iot.updates), orders, now: new Date("2027-01-03T12:00:00Z") }).text).toBeNull();
  });

  it("the owner's note is a line; a trigger edit, by the owner or an agent, and a fire are not", () => {
    expect(list).toContain("  Note by you, Nov 19, 7:20 AM at $38.90: Sell before the report if it is still under $40.");
    expect(text).not.toContain("You changed this trigger");
    expect(text).not.toContain("A level to look again at");
    expect(text).not.toContain("price $39.10");
    // 3 news, the owner's note, then IOT's own four lines.
    expect(list).toHaveLength(8);
  });
});

describe("every kind has a number", () => {
  const mine = (id: string, iso: string): SharedNoteRow => ({ id, author: "OWNER", runId: null, body: `Mine ${id}.`, audience: "STOCKS", analystId: null, tickers: ["IOT"], eventDate: null, pinnedUntil: null, createdAt: new Date(iso), impact: null, effect: null, prices: null });
  const olderDecline: StoredLine = { id: "d-old", type: "PROPOSAL_REJECTED", timestamp: new Date("2026-11-10T15:00:00Z"), summary: "Rejected CLOSE proposal on IOT", rationale: "Not yet.", fieldChanges: { proposal: { from: { status: "AWAITING_APPROVAL", orderId: "o-old" }, to: { intent: "CLOSE", status: "REJECTED", orderId: "o-old", quantity: 300, userMessage: "Not yet." } } } };
  const list = body(iot([...["m4", "m3", "m2", "m1"].map((id, k) => noteLine(mine(id, `2026-11-19T12:1${4 - k}:00Z`), "IOT")), olderDecline]));

  it("the owner's newest 3 notes, and only the last decline", () => {
    expect(list.filter((l) => l.startsWith("  Note by you")).map((l) => l.slice(l.indexOf(": ") + 2))).toEqual(["Mine m4.", "Mine m3.", "Mine m2."]);
    expect(list.filter((l) => l.startsWith("  Declined"))).toHaveLength(1);
    expect(list.join("\n")).not.toContain("Not yet.");
    // 3 reviews + 3 news + 3 notes + 1 decline is the most any stock can carry.
    expect(Object.values(READ).reduce((a, b) => a + b, 0)).toBe(10);
  });
});

describe("one list for every agent", () => {
  it("the Portfolio Manager's row carries the same `said` as an analyst's", () => {
    const row = { id: "t1", ticker: "IOT", status: "HOLDING", direction: "LONG", conviction: "LOW", context: iot(), triggers: [] };
    expect((rowForModel(row) as { said: string }).said).toBe(iot());
  });

  it("a stock with nothing the filter keeps has no `said`", () => {
    const fires = lines(fx.iot.updates).filter((u) => u.type === "TRIGGER_FIRED");
    expect(stockContextFor({ ticker: "IOT", rows: fires }).text).toBeNull();
  });
});

describe("a trigger the owner set says when, and what it was", () => {
  const feed = activityFeed({ updates: lines(fx.mu.updates), orders: [] });
  const sets = ownerSets(feed);
  const FLOOR = "ba421f37-1a10-4fbd-aba8-cafc161c2c6e";
  const row = (withSets: boolean) => ({
    id: "t2", ticker: "MU", status: "HOLDING", direction: "LONG", beyondTheFloor: 1,
    triggers: fx.mu.triggers.map((t) => {
      const set = withSets ? sets.get(t.id) : undefined;
      return { ...triggerForAgent(t), ...(set ? { ownerSetAt: set.at.toISOString(), ...(set.was ? { was: set.was } : {}) } : {}) };
    }),
  });
  const triggerLines = (withSets: boolean) => (rowForModel(row(withSets)) as { triggers: string[] }).triggers;

  it("MU's floor: the owner's newest change, its day in New York, and the price it replaced", () => {
    expect(sets.get(FLOOR)).toEqual({ at: new Date("2026-11-12T02:29:50Z"), was: "$930.60" });
    expect(triggerLines(true)[1]).toBe(`Sell if below $804 · set by you Nov 11, was $930.60 [id ${FLOOR}]`);
  });

  it("an agent's trigger is unchanged, and the owner's with no Activity line loaded still reads set by hand", () => {
    expect(triggerLines(true)[0]).toContain("Review if below $878 · set by the agent · ");
    expect(triggerLines(false)[1]).toBe(`Sell if below $804 · set by hand [id ${FLOOR}]`);
  });

  it("a change that moved nothing in the sentence has no 'was'; an agent's edit is never the owner's", () => {
    const older = ownerSets(feed.filter((i) => i.id !== "cmwcxjsu1000108jmudx23hp7"));
    expect(older.get(FLOOR)).toEqual({ at: new Date("2026-10-23T03:48:15Z"), was: null });
    expect(ownerSets([toFeedItem(lines(fx.mu.updates)[1])]).size).toBe(0);
  });
});
