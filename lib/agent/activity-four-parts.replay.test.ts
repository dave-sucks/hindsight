/**
 * What a look reads of a stock's Activity: four parts, cut by kind
 * (lib/agent/stock-context.ts), and a trigger the owner set says when and
 * what it was. Rows are IOT's and MU's as stored on 2026-11-19
 * (__fixtures__/activity-four-parts-iot-mu-2026-11-19.json says what was cut).
 *
 * IOT is the stock the design was drawn on: its newest lines were one note
 * written twice by one run, on top of a week of sale reviews that each said
 * "weaker", with the owner's decline under them.
 */
import raw from "@/lib/agent/__fixtures__/activity-four-parts-iot-mu-2026-11-19.json";
import { stockContextFor } from "@/lib/agent/stock-context-for";
import { ownerSets } from "@/lib/agent/stock-context";
import { activityFeed, toFeedItem, type ProposalOrder, type StoredLine } from "@/lib/thesis/activity-feed";
import { rowForModel } from "@/lib/agent/row-for-model";
import { triggerForAgent } from "@/lib/agent/triggers/format";
import { noteLine, type SharedNoteRow } from "@/lib/agent/shared-notes";

type Stored = Omit<StoredLine, "timestamp"> & { timestamp: string };
const fx = raw as unknown as {
  iot: { ticker: string; conviction: string; readAt: string; updates: Stored[]; orders: Array<Record<string, unknown>> };
  mu: { triggers: Array<Parameters<typeof triggerForAgent>[0]>; updates: Stored[] };
};
const lines = (rows: Stored[]): StoredLine[] =>
  rows.map((r) => ({ ...r, timestamp: new Date(r.timestamp), answers: r.answers ? { timestamp: new Date(r.answers.timestamp as unknown as string) } : null }));
const day = (v: unknown) => (typeof v === "string" ? new Date(v) : null);
const orders = fx.iot.orders.map((o) => ({ ...o, createdAt: day(o.createdAt), updatedAt: day(o.updatedAt), expiresAt: day(o.expiresAt), alpacaConfirmedAt: day(o.alpacaConfirmedAt) })) as unknown as ProposalOrder[];
const iot = (extra: StoredLine[] = []) => stockContextFor({ ticker: "IOT", rows: [...lines(fx.iot.updates), ...extra], orders, conviction: fx.iot.conviction, now: new Date(fx.iot.readAt) });

const NOTE_1118 = "Samsara is still slipping ahead of its Dec. 3 earnings report";
const DECLINE = "Waiting two more days before I decide.";
const count = (text: string, part: string) => text.split(part).length - 1;

describe("IOT's Activity as its next look reads it", () => {
  const text = iot().text!;
  const at = (label: string) => text.split("\n").findIndex((l) => l.startsWith(label));

  it("is four parts, in order", () => {
    const order = ["Where it stands:", "The last look:", "Since then:", "Open:"].map(at);
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text.split("\n")[0]).toBe("ACTIVITY ON $IOT — where it stands, the last look, what happened since, and what is open:");
  });

  it("where it stands: weaker since the first look that said so, with that look's reason, and conviction", () => {
    expect(text).toContain('Where it stands: weaker since 11-06 — "The business case is still standing, but repeated selling has pushed the stock back below your $42.70 exit');
    expect(text.split("\n")[at("Where it stands:")]).toMatch(/ · conviction LOW$/);
  });

  it("the last look: the 11-18 note in full, once, though the run saved it on two lines", () => {
    expect(fx.iot.updates.filter((u) => u.rationale?.startsWith(NOTE_1118))).toHaveLength(2);
    expect(count(text, NOTE_1118)).toBe(1);
    expect(text).toContain("what would change my mind is a fast move back above the 50-day and our entry before the report.");
    // The second line of the same look keeps what it changed and drops the words already read.
    const look = text.split("\n").slice(at("The last look:") + 1, at("Since then:"));
    expect(look).toHaveLength(2);
    expect(look[0]).toContain("conviction MEDIUM → LOW");
    expect(look[1]).toContain("Not applied: conviction low");
    expect(look[1]).not.toContain("Samsara");
  });

  it("since then: nothing", () => {
    expect(text).toContain("Since then: nothing.");
  });

  it("open: the sale that waits, and the owner's last decline with its words", () => {
    const open = text.split("\n").slice(at("Open:") + 1, -1);
    expect(open).toHaveLength(2);
    expect(open[0]).toBe("  11-17 09:30 · $40.58 · Proposed sell 300 shares — awaiting your review · weaker [id cmwkshvhh000b07l9zjn05ozc]");
    expect(open[1]).toContain(`11-16 21:18 · $40.85 · Declined sell 300 shares — "${DECLINE}"`);
  });

  it("no paragraph and no verdict line reads twice", () => {
    for (const said of text.match(/"[^"]{40,}"/g) ?? []) expect(count(text, said)).toBe(1);
  });

  it("the older looks, the fires that woke them and the lapsed proposals are not sent", () => {
    expect(text).not.toContain("11-13");
    expect(text).not.toContain("Trigger:");
    expect(text).not.toContain("Expired");
    expect(text.length).toBeLessThan(2000);
  });
});

describe("what happened since the last look", () => {
  const after = (iso: string, line: Partial<StoredLine>): StoredLine => ({ id: `x-${iso}`, type: "UPDATED", timestamp: new Date(iso), ...line });
  const fire = (iso: string, price: number, condition: unknown, summary: string, triggerId: string): StoredLine =>
    after(iso, { id: `f-${iso}`, type: "TRIGGER_FIRED", summary, triggerId, triggerAction: "REVIEW", triggerCondition: condition, priceAtTime: price });
  const news: SharedNoteRow = { id: "n1", author: "MARKET_REVIEWER", runId: "mr", body: "Samsara's CFO said she will leave in January.", audience: "STOCKS", analystId: null, tickers: ["IOT"], eventDate: null, pinnedUntil: null, createdAt: new Date("2026-11-19T12:35:00Z"), impact: "high", effect: "weaker", prices: { IOT: 38.9 } };
  const text = iot([
    noteLine(news, "IOT"),
    fire("2026-11-18T15:00:00Z", 39.1, { is: "below", value: 42.7, watch: "price" }, "Sell if below $42.70", "cf1e7fd0-8bcc-4629-b605-5d1da41735c2"),
    fire("2026-11-18T20:20:00Z", 38.8, { is: "below", value: 42.7, watch: "price" }, "Sell if below $42.70", "cf1e7fd0-8bcc-4629-b605-5d1da41735c2"),
    fire("2026-11-18T21:20:00Z", 38.8, { is: "before", value: 5, watch: "report" }, "Review if within 5 days before earnings", "2a0a08cf-e531-44f0-90bd-ce0e4eea63f7"),
    after("2026-11-18T22:00:00Z", { summary: "You changed a trigger on IOT: Sell if below $40", fieldChanges: { source: { from: null, to: "USER" }, triggerOps: { from: null, to: [{ id: "cf1e7fd0-8bcc-4629-b605-5d1da41735c2", op: "edit", text: "Changed: Sell if below $42.70 → Sell if below $40" }] } } }),
  ]).text!;
  const since = text.split("\n").slice(text.split("\n").findIndex((l) => l === "Since then:") + 1, text.split("\n").findIndex((l) => l.startsWith("Open:")));

  it("is one line each: the news with its first read, the owner's trigger change, a report's fire; price fires are one count", () => {
    expect(since).toHaveLength(4);
    expect(since[0]).toContain('Agent note to IOT · high impact · weaker — "Samsara\'s CFO said she will leave in January."');
    expect(since[1]).toContain("Edited by you [Changed: Sell if below $42.70 → Sell if below $40]");
    expect(since[2]).toContain("Trigger: Review if within 5 days before earnings");
    expect(since[3]).toBe("  Triggers fired 2 times: Sell if below $42.70 ×2 (last 11-18 15:20 at $38.80)");
  });
});

describe("a stock compared across the account gets the first and last parts only", () => {
  const { brief } = iot();
  it("where it stands and what is open; no last look, no since", () => {
    expect(brief!.split("\n")[0]).toMatch(/^Where it stands: weaker since 11-06/);
    expect(brief).toContain("Open:");
    expect(brief).toContain(DECLINE);
    expect(brief).not.toContain("The last look");
    expect(brief).not.toContain("Since then");
    expect(brief).not.toContain(NOTE_1118);
  });

  it("is the `said` the Portfolio Manager's row carries; an analyst's row carries all four", () => {
    const row = { id: "t1", ticker: "IOT", status: "HOLDING", direction: "LONG", conviction: "LOW", context: iot().text, contextBrief: brief, triggers: [] };
    expect((rowForModel(row, { named: true, size: "short", comparing: true }) as { said: string }).said).toBe(brief);
    expect((rowForModel(row, { named: false, size: "short" }) as { said: string }).said).toBe(iot().text);
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
  const triggerLines = (withSets: boolean) => (rowForModel(row(withSets), { named: false, size: "short" }) as { triggers: string[] }).triggers;

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
