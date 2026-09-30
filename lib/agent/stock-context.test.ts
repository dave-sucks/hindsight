/**
 * stock-context.test.ts — the pure rules behind the "what's been said"
 * block: what counts as an agent's answer, which fires are still open, and
 * how the principal's decisions read. Rows are CEG's and DOCU's, as stored.
 */
import raw from "@/lib/agent/__fixtures__/ceg-what-was-said-2026-09.json";
import {
  buildStockContext,
  isAgentAnswer,
  isPrincipalRow,
  openFires,
  principalDecision,
  CONTEXT_CHAR_CAP,
  type ActivityRow,
} from "@/lib/agent/stock-context";
import { computeNeedsAction } from "@/lib/agent/needs-action";
import type { Trigger } from "@/lib/agent/triggers/types";

type StoredRow = Omit<ActivityRow, "timestamp"> & { timestamp: string };
const fx = raw as unknown as { updates: StoredRow[] };
const rows: ActivityRow[] = fx.updates.map((r) => ({ ...r, timestamp: new Date(r.timestamp) }));
const before = (iso: string) => rows.filter((r) => r.timestamp.getTime() < new Date(iso).getTime());
const byId = (id: string) => rows.find((r) => r.id === id)!;

const FIFTEEN_OFF_HIGH = "06506e39-522f-4ad1-aa62-d7fe10bf7003";
const BELOW_200_DAY = "cf39ff35-5a15-43d4-a0f1-911cb5fd519b";
const EIGHT_UNDER_COST = "a2fa9578-c744-4568-a02c-ec2c2333f5a0";

describe("who answered", () => {
  it("a run's review is an answer; a fire, the principal's decline and the app's bookkeeping are not", () => {
    expect(isAgentAnswer(byId("cmu6wy0gy001504l4naxr2ipd"))).toBe(true); // 09-18 morning run
    expect(isAgentAnswer(byId("cmu1ex281000104jq0w42txms"))).toBe(false); // 09-14 decline
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
      { id: FIFTEEN_OFF_HIGH, action: "REVIEW", predicate: { kind: "TRAILING_FROM_HIGH", pct: 15 }, rationale: "15% off the high" },
    ] as unknown as Trigger[];
    const na = computeNeedsAction({
      thesis: { id: "cmqb2ku1a000q04l6jtquuqr6", status: "HOLDING", direction: "LONG", triggers, createdAt: new Date("2026-06-12T15:16:50Z"), lastReviewedAt: new Date("2026-09-28T12:04:39Z") },
      activity: before("2026-09-30T12:04:25Z"),
      now: new Date("2026-09-30T12:04:25Z"),
    });
    expect(na).toMatchObject({ kind: "TRIGGER_FIRED", triggerId: FIFTEEN_OFF_HIGH, action: "REVIEW" });
  });
});

const DECLINE = "cmu1ex281000104jq0w42txms";

describe("the principal's decisions, as read", () => {
  // CEG 2026-09-30 16:07Z, as stored.
  const floorEdit: ActivityRow = {
    type: "UPDATED",
    timestamp: new Date("2026-09-30T16:07:01.922Z"),
    runId: null,
    summary: "Principal edited CEG trigger — Price 248",
    rationale: '[USER] Principal set Price = 248 on the "EXIT" trigger directly. Honor it; don\'t re-propose against it unless the thesis materially changes.',
    fieldChanges: { source: { to: "USER", from: null }, stopLoss: { to: 248, from: 220 }, triggerOps: { to: [{ id: "cafcc57b-4b0c-47ee-b2c2-d4cd6e0b942e", op: "edit", text: "Stop $220 → $248 (tightened)" }], from: null } },
  };

  it("the 09-14 decline is word for word, uncut, with the price then and now", () => {
    const d = principalDecision(byId(DECLINE), 273.98, 264.6)!;
    expect(d.wantsAnswer).toBe(true);
    expect(d.line.startsWith("Declined the sale (30 shares) at $273.98, now $264.60 (−3.4%): \"now the strongest hold of the five")).toBe(true);
    expect(d.line.endsWith("Hard reject. If anything, today is a setup for the Secular Compounder to add, not exit.\"")).toBe(true);
  });

  it("a smaller approved size reads as cut, not raised (DOCU 2026-09-30, 162 → 120 shares)", () => {
    const docu: ActivityRow = {
      type: "PROPOSAL_APPROVED",
      timestamp: new Date("2026-09-30T16:25:14.191Z"),
      runId: null,
      summary: "Approved OPEN on DOCU (edited 162→120 sh) — submitted to Alpaca (idem=4f185947)",
      rationale: "User approved the OPEN proposal, resizing 162→120 shares. Alpaca order id 23e155a2-a3f5-4f43-b485-9e4080230f6a.",
      fieldChanges: { proposal: { to: { edited: true, intent: "OPEN", status: "APPROVED", quantity: 120, proposedQuantity: 162 } } },
    };
    expect(principalDecision(docu, 68.18)).toMatchObject({ line: "Approved the buy, cut from 162 to 120 shares at $68.18", wantsAnswer: true });
  });

  it("nothing to decide is not shown: a plain approval, a removal-only hand edit", () => {
    expect(principalDecision(rows.find((r) => r.type === "PROPOSAL_APPROVED")!)).toBeNull();
    expect(principalDecision(rows.find((r) => r.summary?.startsWith("Principal removed CEG trigger"))!)).toBeNull();
    for (const r of rows.filter((x) => x.summary?.startsWith("Removed a copied rule from CEG"))) {
      expect(principalDecision(r)).toBeNull();
    }
  });

  it("a level set by hand shows only the change, not the app's own sentence", () => {
    const d = principalDecision(floorEdit, 250.1, 249.69)!;
    expect(d).toMatchObject({ wantsAnswer: true, line: "Set by hand: Stop $220 → $248 (tightened) at $250.10, now $249.69 (−0.2%)" });
    expect(d.line).not.toContain("Honor it");
  });
});

describe("the block, counted from the analyst's last answer", () => {
  const labelFor = (id: string) =>
    id === FIFTEEN_OFF_HIGH
      ? { label: "15% off the high → review", rationale: "Gave back 15% from the high. This is a question, not a sale: is the reason we bought still true? If yes, hold and raise the floor under real structure (the 20-day low, the breakout level). If partly, trim. Sell only if you can name what broke in the business." }
      : null;
  const block = (at: string, price: number | null = null) =>
    buildStockContext({ ticker: "CEG", rows: before(at), labelFor, now: new Date(at), currentPrice: price });

  it("09-30 morning read: the last look, and the one review nobody answered — nothing else", () => {
    const { text, unansweredDecision } = block("2026-09-30T12:04:25Z", 261.25);
    expect(text).toMatch(/^WHAT'S BEEN SAID ON \$CEG\nLast look: morning run, 09-28 08:04 — "CEG's repeated 200-day review/);
    expect(text).toContain("Since then, not yet answered:\n  15% off the high → review — 09-28 11:20 at $257.63.");
    expect(text).toContain("If yes, hold and raise the floor under real structure (the 20-day low, the breakout level).");
    // The cleanup, the answered 09-14 decline, the approval, the bookkeeping: all gone.
    expect(text).not.toContain("copied rule");
    expect(text).not.toContain("Hard reject");
    expect(text).not.toContain("Approved");
    expect(text).not.toContain("buy price set");
    expect(unansweredDecision).toBeNull();
    expect(text!.length).toBeLessThan(700);
  });

  it("09-18 morning read: the 09-16 answer and all three fires since it, collapsed", () => {
    const { text } = block("2026-09-18T12:06:25Z", 262.73);
    expect(text).toContain("Last look: morning run, 09-16 08:07");
    expect(text).toContain("raise the floor under real structure");
    expect(text).toMatch(/fired 2×, 09-16 09:35 to 09-17 09:35, last at \$267\.02/);
    expect(text).not.toContain("Hard reject");
  });

  it("the 09-14 15:30 trigger run gets the decline uncut, with the price then and now; the next answer closes it", () => {
    const at1530 = block("2026-09-14T19:30:20Z", 264.6);
    expect(at1530.text).toContain("The principal, 09-14 11:43: Declined the sale (30 shares) at $273.98, now $264.60 (−3.4%)");
    expect(at1530.text).toContain("Hard reject. If anything, today is a setup for the Secular Compounder to add, not exit.");
    expect(at1530.unansweredDecision?.at).toEqual(byId(DECLINE).timestamp);
    const at1555 = block("2026-09-14T19:55:13Z", 264.99);
    expect(at1555.text).not.toContain("Hard reject");
    expect(at1555.unansweredDecision).toBeNull();
  });

  it("past the cap, the alerts that don't fit fold into a count; the principal's words are never cut", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    const answer: ActivityRow = { type: "UPDATED", timestamp: new Date("2026-09-19T12:00:00Z"), runId: "r1", runMode: "MORNING_PLAN", rationale: "Hold." };
    const long = "x".repeat(900);
    const decline: ActivityRow = { type: "PROPOSAL_REJECTED", timestamp: new Date("2026-09-19T15:00:00Z"), runId: null, fieldChanges: { proposal: { to: { intent: "CLOSE", userMessage: long } } } };
    const fires: ActivityRow[] = Array.from({ length: 8 }, (_, i) => ({ type: "TRIGGER_FIRED", triggerId: `t${i}`, timestamp: new Date(`2026-09-19T16:0${i}:00Z`), runId: null, summary: `alert ${i}` }));
    const labels = (id: string) => ({ label: `alert ${id}`, rationale: "y".repeat(200) });
    const { text } = buildStockContext({ ticker: "X", rows: [answer, decline, ...fires], labelFor: labels, now });
    expect(text).toContain(long);
    expect(text).toMatch(/ and \d more fired since: /);
    expect(text!.length - long.length).toBeLessThanOrEqual(CONTEXT_CHAR_CAP);
  });

  it("nothing on record → no block; an answer with nothing since → the last look only", () => {
    expect(buildStockContext({ ticker: "X", rows: [], labelFor, now: new Date() }).text).toBeNull();
    const only: ActivityRow = { type: "REVIEWED", timestamp: new Date("2026-09-28T12:00:00Z"), runId: "r", runMode: "MORNING_PLAN", rationale: "Nothing changed. Hold." };
    expect(buildStockContext({ ticker: "X", rows: [only], labelFor, now: new Date() }).text).toBe(
      'WHAT\'S BEEN SAID ON $X\nLast look: morning run, 09-28 08:00 — "Nothing changed. Hold."\nNothing since.\nFull history: get_theses(tickers: ["X"], include_history: true)',
    );
  });
});
