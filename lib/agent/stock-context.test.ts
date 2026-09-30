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

describe("the principal's decisions, as read", () => {
  it("the 09-14 decline is word for word", () => {
    const d = principalDecision(byId("cmu1ex281000104jq0w42txms"))!;
    expect(d.wantsAnswer).toBe(true);
    expect(d.line).toContain("Declined the sale (30 shares)");
    expect(d.line).toContain("Hard reject. If anything, today is a setup for the Secular Compounder to add, not exit.");
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
    expect(principalDecision(docu)).toMatchObject({ line: "Approved the buy, cut from 162 to 120 shares", wantsAnswer: true });
  });

  it("a plain approval is shown but asks for nothing", () => {
    const d = principalDecision(byId(rows.find((r) => r.type === "PROPOSAL_APPROVED")!.id!))!;
    expect(d).toMatchObject({ wantsAnswer: false });
    expect(d.line).toMatch(/^Approved the add/);
  });

  it("a hand edit carries its own words", () => {
    const d = principalDecision(rows.find((r) => r.summary?.startsWith("Principal removed CEG trigger"))!)!;
    expect(d.line).toBe(
      'Principal removed CEG trigger — Trailing 8% from high → exit: "Removed the "EXIT" trigger (Trailing 8% from high). Don\'t re-create it unless the thesis materially changes."',
    );
  });
});

describe("the block", () => {
  const labelFor = (id: string) =>
    id === FIFTEEN_OFF_HIGH
      ? { label: "15% off the high → review", rationale: "Gave back 15% from the high. This is a question, not a sale: is the reason we bought still true? If yes, hold and raise the floor under real structure (the 20-day low, the breakout level)." }
      : null;

  it("09-18: the decline, the last two answers, and all three open fires", () => {
    const { text, unansweredDecision } = buildStockContext({ ticker: "CEG", rows: before("2026-09-18T12:06:25Z"), labelFor, now: new Date("2026-09-18T12:06:25Z") });
    expect(text).toContain("WHAT'S BEEN SAID ON $CEG");
    expect(text).toContain("09-14 11:43  Declined the sale (30 shares)");
    expect(text).toContain("Hard reject. If anything, today is a setup for the Secular Compounder to add, not exit.");
    expect(text).toContain("09-16 08:07  morning run");
    expect(text).toContain("Fired since the last answer (09-16 08:07), not yet answered:");
    expect(text).toContain("raise the floor under real structure");
    expect(text).toMatch(/2×, first 09-16 09:35, last 09-17 09:35/);
    // The decline was answered by the 09-14 trigger runs that came after it.
    expect(unansweredDecision).toBeNull();
    expect(text!.length).toBeLessThanOrEqual(CONTEXT_CHAR_CAP);
  });

  it("a decision no run has answered yet is flagged, and the next run's line answers it", () => {
    const decline = byId("cmu1ex281000104jq0w42txms");
    const until = before("2026-09-14T15:43:30Z");
    expect(buildStockContext({ ticker: "CEG", rows: until, labelFor, now: decline.timestamp }).unansweredDecision?.at).toEqual(decline.timestamp);
    const after = before("2026-09-14T19:31:00Z");
    expect(buildStockContext({ ticker: "CEG", rows: after, labelFor, now: new Date("2026-09-14T19:31:00Z") }).unansweredDecision).toBeNull();
  });

  it("nothing said → no block", () => {
    expect(buildStockContext({ ticker: "X", rows: [], labelFor, now: new Date() }).text).toBeNull();
  });
});
