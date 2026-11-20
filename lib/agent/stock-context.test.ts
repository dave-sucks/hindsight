/**
 * stock-context.test.ts — the rules behind what a run reads on a stock: what
 * counts as an agent's answer, which fires are still open, which of the
 * principal's lines ask for an answer, and the block itself: the stock's
 * Activity as one list. Rows are CEG's and DOCU's, as stored.
 */
import raw from "@/lib/agent/__fixtures__/ceg-what-was-said-2026-09.json";
import {
  buildStockContext,
  isAgentAnswer,
  isPrincipalRow,
  openFires,
  type ActivityRow,
} from "@/lib/agent/stock-context";
import { activityFeed, toFeedItem } from "@/lib/thesis/activity-feed";
import { computeNeedsAction } from "@/lib/agent/needs-action";
import type { Trigger } from "@/lib/agent/triggers/types";

/** The lead: the first entry on the stock's list, null when nothing is true. */
const leadOf = (...a: Parameters<typeof computeNeedsAction>) => computeNeedsAction(...a)[0] ?? null;

type StoredRow = Omit<ActivityRow, "timestamp"> & { id: string; summary: string; timestamp: string };
const fx = raw as unknown as { updates: StoredRow[] };
const rows = fx.updates.map((r) => ({ ...r, timestamp: new Date(r.timestamp) }));
const before = (iso: string) => rows.filter((r) => r.timestamp.getTime() < new Date(iso).getTime());
const byId = (id: string) => rows.find((r) => r.id === id)!;
const feedBefore = (iso: string) => activityFeed({ updates: before(iso), orders: [] });

const FIFTEEN_OFF_HIGH = "06506e39-522f-4ad1-aa62-d7fe10bf7003";
const BELOW_200_DAY = "cf39ff35-5a15-43d4-a0f1-911cb5fd519b";
const EIGHT_UNDER_COST = "a2fa9578-c744-4568-a02c-ec2c2333f5a0";
const DECLINE = "cmu1ex281000104jq0w42txms";
const DECLINE_ENDS = "Hard reject. If anything, today is a setup for the Secular Compounder to add, not exit.";

describe("who answered", () => {
  it("a run's review is an answer; a fire, the principal's decline and the app's bookkeeping are not", () => {
    expect(isAgentAnswer(byId("cmu6wy0gy001504l4naxr2ipd"))).toBe(true); // 09-18 morning run
    expect(isAgentAnswer(byId(DECLINE))).toBe(false); // 09-14 decline
    expect(isAgentAnswer(byId("cmu1nwuuj000b04l508wpj29l"))).toBe(false); // "buy price set to what was paid"
    expect(rows.filter((r) => r.type === "TRIGGER_FIRED").some(isAgentAnswer)).toBe(false);
  });

  it("the 09-28 cleanup of copied rules is the principal's, not an answer", () => {
    const cleanup = rows.filter((r) => r.summary?.startsWith("Removed a copied rule from CEG"));
    expect(cleanup).toHaveLength(2);
    for (const r of cleanup) {
      expect(isPrincipalRow(r)).toBe(true);
      expect(isAgentAnswer(r)).toBe(false);
    }
  });
});

describe("open fires on CEG", () => {
  it("on 09-18 before the morning run: three fired since the 09-16 answer, not just the newest", () => {
    const open = openFires(before("2026-09-18T12:06:25Z"));
    expect(open.map((f) => f.triggerId).sort()).toEqual([BELOW_200_DAY, EIGHT_UNDER_COST, FIFTEEN_OFF_HIGH].sort());
    const twoHundred = open.find((f) => f.triggerId === BELOW_200_DAY)!;
    expect(twoHundred.count).toBe(2);
    expect(open.find((f) => f.triggerId === FIFTEEN_OFF_HIGH)!.lastPrice).toBe(257.59);
  });

  it("on 09-30 before the morning run: the 09-28 15%-off-the-high review is still open under the cleanup", () => {
    const open = openFires(before("2026-09-30T12:04:25Z"));
    expect(open.map((f) => f.triggerId)).toEqual([FIFTEEN_OFF_HIGH]);
    expect(open[0].lastAt.toISOString().slice(0, 16)).toBe("2026-09-28T15:20");
  });

  it("needsAction keeps the fire open under the principal's edit (on main the edit answered it)", () => {
    const triggers = [
      { id: FIFTEEN_OFF_HIGH, action: "REVIEW", predicate: { watch: "move", is: "below", value: 15, variable: "peak" }, rationale: "15% off the high" },
    ] as unknown as Trigger[];
    const na = leadOf({
      thesis: { id: "cmqb2ku1a000q04l6jtquuqr6", status: "HOLDING", direction: "LONG", triggers, createdAt: new Date("2026-06-12T15:16:50Z"), lastReviewedAt: new Date("2026-09-28T12:04:39Z") },
      activity: before("2026-09-30T12:04:25Z"),
      now: new Date("2026-09-30T12:04:25Z"),
    });
    expect(na).toMatchObject({ kind: "TRIGGER_FIRED", triggerId: FIFTEEN_OFF_HIGH, action: "REVIEW" });
  });
});

describe("the block: the stock's Activity as one list", () => {
  const body = (text: string | null) => text!.split("\n").slice(1, -1);

  it("09-30 morning read: the last 3 reviews and the owner's decline, newest first", () => {
    const { text } = buildStockContext({ ticker: "CEG", feed: feedBefore("2026-09-30T12:04:25Z") });
    expect(text!.split("\n")[0]).toBe("Activity on $CEG in the last 45 days, newest first: the last 3 reviews, 3 news notes and 3 of your notes, and your last decline.");
    expect(body(text).map((l) => l.slice(0, l.indexOf(": ")))).toEqual([
      "  Review by its analyst, Sep 28, 8:04 AM at $261.23",
      "  Review by its analyst, Sep 25, 8:02 AM at $261.62",
      "  Review by its analyst, Sep 23, 8:04 AM at $263.46",
      "  Declined sell 30 shares by you, Sep 14, 11:43 AM",
    ]);
    // The 15% review that fired after the last review, the owner's 09-15 removal and the 09-28 cleanup are not in it.
    expect(text).not.toContain("Trailing 15% from high");
    expect(text).not.toContain("Trailing 8% from high");
    expect(text).not.toContain("copied rule");
    expect(text!.split("\n").at(-1)).toBe('Full history: get_theses(tickers: ["CEG"], include_history: true)');
  });

  it("09-14 15:30 trigger run: the principal's decline, every one of its 709 characters", () => {
    const { text } = buildStockContext({ ticker: "CEG", feed: feedBefore("2026-09-14T19:30:20Z") });
    const whole = ((byId(DECLINE).fieldChanges as { proposal: { to: { userMessage: string } } }).proposal.to.userMessage).replace(/\s+/g, " ").trim();
    expect(whole.length).toBeGreaterThan(600);
    expect(body(text)[0]).toBe(`  Declined sell 30 shares by you, Sep 14, 11:43 AM: ${whole} [id ${DECLINE}]`);
    expect(text).toContain(DECLINE_ENDS);
  });

  it("a note reads whole, with its id, the one a later note answers", () => {
    const long = "x".repeat(2_000);
    const note = toFeedItem({ id: "n", type: "NOTE", timestamp: new Date("2026-10-01T10:00:00Z"), runId: "chat", summary: "x", rationale: long, priceAtTime: 100 });
    expect(body(buildStockContext({ ticker: "X", feed: [note] }).text)).toEqual([`  Note by you, Oct 1, 6:00 AM at $100.00: ${long} [id n]`]);
  });

  it("nothing on record, or only fires and edits → no block", () => {
    expect(buildStockContext({ ticker: "X", feed: [] }).text).toBeNull();
    const fire = toFeedItem(byId("cmule97cz000004jzj66w096e"));
    const edit = toFeedItem(rows.find((r) => r.summary?.startsWith("Principal removed CEG trigger"))!);
    expect(buildStockContext({ ticker: "CEG", feed: [fire, edit] }).text).toBeNull();
  });
});
