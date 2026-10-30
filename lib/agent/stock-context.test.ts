/**
 * stock-context.test.ts — the rules behind what a run reads on a stock: what
 * counts as an agent's answer, which fires are still open, which of the
 * principal's lines ask for an answer, and the block itself: the newest 8
 * Activity lines as they read, whole. Rows are CEG's and DOCU's, as stored.
 */
import raw from "@/lib/agent/__fixtures__/ceg-what-was-said-2026-09.json";
import {
  buildStockContext,
  isAgentAnswer,
  isPrincipalRow,
  openFires,
  saidLine,
  unansweredWord,
  wantsAnswer,
  type ActivityRow,
} from "@/lib/agent/stock-context";
import { activityFeed, recentItems, RECENT_ITEMS, toFeedItem } from "@/lib/thesis/activity-feed";
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

describe("which of the principal's lines ask a run for an answer", () => {
  // CEG 2026-09-30 16:07Z, as stored.
  const floorEdit: ActivityRow = {
    type: "UPDATED",
    timestamp: new Date("2026-09-30T16:07:01.922Z"),
    runId: null,
    summary: "Principal edited CEG trigger — Price 248",
    rationale: '[USER] Principal set Price = 248 on the "EXIT" trigger directly. Honor it; don\'t re-propose against it unless the thesis materially changes.',
    fieldChanges: { source: { to: "USER", from: null }, stopLoss: { to: 248, from: 220 }, triggerOps: { to: [{ id: "cafcc57b-4b0c-47ee-b2c2-d4cd6e0b942e", op: "edit", text: "Stop $220 → $248 (tightened)" }], from: null } },
  };

  it("a decline with a comment, a resized approval, a hand edit, a removal by hand, a note: yes", () => {
    expect(wantsAnswer(byId(DECLINE))).toBe(true);
    const docu: ActivityRow = {
      type: "PROPOSAL_APPROVED",
      timestamp: new Date("2026-09-30T16:25:14.191Z"),
      runId: null,
      summary: "Approved OPEN on DOCU (edited 162→120 sh) — submitted to Alpaca (idem=4f185947)",
      fieldChanges: { proposal: { to: { edited: true, intent: "OPEN", status: "APPROVED", quantity: 120, proposedQuantity: 162 } } },
    };
    expect(wantsAnswer(docu)).toBe(true);
    expect(wantsAnswer(floorEdit)).toBe(true);
    expect(wantsAnswer(rows.find((r) => r.summary?.startsWith("Principal removed CEG trigger"))!)).toBe(true);
    expect(wantsAnswer({ type: "NOTE", timestamp: new Date(), runId: "chat", rationale: "Starter only." })).toBe(true);
  });

  it("a plain approval, a bare decline, the cleanup of copied rules, a run's line: no", () => {
    expect(wantsAnswer(rows.find((r) => r.type === "PROPOSAL_APPROVED")!)).toBe(false);
    expect(wantsAnswer({ type: "PROPOSAL_REJECTED", timestamp: new Date(), runId: null, fieldChanges: { proposal: { to: { intent: "CLOSE" } } } })).toBe(false);
    for (const r of rows.filter((x) => x.summary?.startsWith("Removed a copied rule from CEG"))) expect(wantsAnswer(r)).toBe(false);
    expect(wantsAnswer(byId("cmu6wy0gy001504l4naxr2ipd"))).toBe(false);
  });

  it("the 09-14 decline waits for an answer until the 15:30 trigger run writes one", () => {
    expect(unansweredWord(before("2026-09-14T19:30:20Z"))?.at).toEqual(byId(DECLINE).timestamp);
    expect(unansweredWord(before("2026-09-14T19:55:13Z"))).toBeNull();
  });

  it("a note newer than the last answer puts the stock on the list; an older one is answered", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
    const note = (h: number, text: string): ActivityRow => ({ id: `n${h}`, type: "NOTE", timestamp: at(h), runId: "chat", rationale: text, priceAtTime: 100 });
    const answer: ActivityRow = { id: "a", type: "UPDATED", timestamp: at(12), runId: "r", runMode: "MORNING_PLAN", rationale: "Hold." };
    expect(unansweredWord([answer, note(14, "Starter only: the base hasn't resolved.")])?.at).toEqual(at(14));
    expect(unansweredWord([answer, note(10, "Starter only.")])).toBeNull();
  });
});

describe("the block: the newest 8 lines of the feed, as the owner sees them, whole", () => {
  it("09-30 morning read: the 8 newest, newest first, each as the Activity tab titles it", () => {
    const feed = feedBefore("2026-09-30T12:04:25Z");
    const { text, unansweredDecision } = buildStockContext({ ticker: "CEG", feed });
    const lines = text!.split("\n");
    expect(lines[0]).toBe("WHAT'S BEEN SAID ON $CEG — its newest 8 Activity lines, newest first, as the owner sees them:");
    expect(lines).toHaveLength(RECENT_ITEMS + 2);
    // The same 8 the Overview shows, in the same order.
    expect(lines.slice(1, 9).map((l) => l.slice(2, 13))).toEqual(recentItems(feed).map((i) => saidLine(i).slice(2, 13)));
    // The 09-28 morning note, whole; the 15% review that fired after it, as the tab titles it.
    expect(text).toContain('09-28 08:04 · $261.23 · Review — "CEG\'s repeated 200-day review');
    expect(text).toContain("09-28 11:20 · $257.63 · Trigger: Trailing 15% from high — review");
    // Older than the 8: the 09-14 decline and the 09-15 removal are not here; the full history is one call away.
    expect(text).not.toContain(DECLINE_ENDS);
    expect(text).not.toContain("Trailing 8% from high");
    expect(lines[9]).toBe('Full history: get_theses(tickers: ["CEG"], include_history: true)');
    expect(unansweredDecision).toBeNull();
  });

  it("09-14 15:30 trigger run: the principal's decline is in the 8, every one of its 709 characters", () => {
    const { text, unansweredDecision } = buildStockContext({ ticker: "CEG", feed: feedBefore("2026-09-14T19:30:20Z") });
    const whole = ((byId(DECLINE).fieldChanges as { proposal: { to: { userMessage: string } } }).proposal.to.userMessage).replace(/\s+/g, " ").trim();
    expect(whole.length).toBeGreaterThan(600);
    expect(text).toContain(`Declined sell 30 shares — "${whole}"`);
    expect(text).toContain(DECLINE_ENDS);
    expect(unansweredDecision?.at).toEqual(byId(DECLINE).timestamp);
  });

  it("a line reads the same whoever wrote it: a fire with its figures, a hand edit with its change, a note in full", () => {
    const fire = toFeedItem(byId("cmule97cz000004jzj66w096e"));
    expect(saidLine(fire)).toMatch(/^ {2}09-28 11:20 · \$257\.63 · Trigger: Trailing 15% from high — review — "Gave back 15% from the high\./);
    const edit = toFeedItem(rows.find((r) => r.summary?.startsWith("Principal removed CEG trigger"))!);
    expect(saidLine(edit)).toContain("Edited by you [Removed: Trailing 8% from high → exit]");
    const long = "x".repeat(2_000);
    const note = toFeedItem({ id: "n", type: "NOTE", timestamp: new Date("2026-10-01T10:00:00Z"), runId: "chat", summary: "x", rationale: long, priceAtTime: 100 });
    expect(saidLine(note)).toBe(`  10-01 06:00 · $100.00 · Your note — "${long}"`);
  });

  it("nothing on record → no block", () => {
    expect(buildStockContext({ ticker: "X", feed: [] }).text).toBeNull();
  });
});
