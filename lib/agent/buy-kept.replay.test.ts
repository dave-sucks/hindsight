/**
 * buy-kept.replay.test.ts — a run may move a buy, replace it, or let the
 * stock go. It may not take the buy off and keep watching.
 *
 * Live account (34f5c589), 30 days to 2026-09-28. Every edit to a buy
 * price, by who made it (query: `ThesisUpdate.summary` matched for
 * "Added: buy / Entry set" and "Removed: buy", joined to the run's mode):
 *
 *                     put one on   took one off
 *   morning runs           4            8
 *   trigger runs           0            1
 *   writers                2            4
 *   the principal's chat   9            0
 *
 * Every removal below is the stored call, through the real `update_thesis`.
 * On main each of them lands. The ones marked "waiting on a date" still do.
 */
import { replayTool, thesisRow, REPLAY_ANALYST_ID } from "@/lib/replay";
import { checkLadder } from "@/lib/agent/triggers/ops";
import { validateBuyKept } from "@/lib/agent/triggers/enter-guard";
import { computePlanSanity, waitingOnADate } from "@/lib/agent/plan-sanity";
import type { Trigger } from "@/lib/agent/triggers/types";

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);

/** A priced plan: buy, floor, target, and the review clock beside them. */
const plan = (o: { buy: { kind: "PRICE_ABOVE" | "PRICE_BELOW"; level: number; basis?: "close" }; floor: number; target: number }) =>
  [
    { id: "buy", predicate: o.buy, action: "ENTER", rationale: "The buy.", source: "AGENT", cooldownDays: 1 },
    { id: "floor", predicate: { kind: "PRICE_BELOW", level: o.floor }, action: "EXIT", rationale: "The floor.", source: "DEFAULT", cooldownDays: 1 },
    { id: "target", predicate: { kind: "PRICE_ABOVE", level: o.target }, action: "REVIEW", rationale: "The target.", source: "AGENT", cooldownDays: 1 },
    { id: "clock", predicate: { kind: "REVIEW_CADENCE", days: 14 }, action: "REVIEW", rationale: "Every two weeks.", source: "DEFAULT", cooldownDays: 14 },
  ] as unknown as Trigger[];

const update = (row: Record<string, unknown>, args: Record<string, unknown>, price: number, runMode = "MORNING_PLAN") =>
  replayTool("update-thesis", "updateThesis", {
    seed: { thesis: [thesisRow({ id: "t", status: "WATCHING", direction: "LONG", ...row })] },
    ctx: { runMode, analystId: REPLAY_ANALYST_ID },
    args: { thesis_id: "t", price_at_time: price, ...args },
    quotes: { [String(row.ticker)]: price },
  });

const buysOn = (db: { store: Record<string, Array<Record<string, unknown>>> }) =>
  ((db.store.thesis[0].triggers ?? []) as Trigger[]).filter((t) => t.action === "ENTER");

// ── Refused: the stock would be left on watch with nothing that can buy it ──

describe("taking the buy off and keeping the stock on watch is refused", () => {
  it("CYTK, morning run 2026-09-28 08:02 — 'the current priced ladder is not earned'", async () => {
    // Set by the principal's chat on 09-24 (buy above $70.05 on a close,
    // 3:1). Four days later a morning run took it off. Event 11-14, 47
    // days out: the buying window is open.
    const cytk = {
      ticker: "CYTK", horizon: "CATALYST", setupId: "NONE", catalystDate: inDays(47),
      entryPrice: 70.05, stopLoss: 64, targetPrice: 88,
      triggers: plan({ buy: { kind: "PRICE_ABOVE", level: 70.05, basis: "close" }, floor: 64, target: 88 }),
    };
    const { refused, refusal, db } = await update(
      cytk,
      { remove_trigger_ids: ["buy", "floor", "target"], rationale: "CYTK's current priced ladder is not earned. Fresh tape at $64.66 has worsened since the last refresh." },
      64.66,
    );
    expect(refused).toBe(true);
    expect(refusal?.error).toBe("buy_removed");
    expect(buysOn(db)).toHaveLength(1);
    // The refusal names the three answers and never the delete.
    expect(refusal?.message).toContain("MOVE the buy");
    expect(refusal?.message).toContain("REPLACE the plan");
    expect(refusal?.message).toContain("LET IT GO");
    expect(refusal?.message).not.toMatch(/set the plan down/i);
    expect(refusal?.message).toContain('buy above $70.05 (id "buy")');
  });

  it("NOW, morning run 2026-09-28 08:05 — refused on 2:1 first, then took the plan off", async () => {
    const now = {
      ticker: "NOW", horizon: "COMPOUNDER", setupId: "MA_PULLBACK",
      entryPrice: 130, stopLoss: 112, targetPrice: 175,
      triggers: plan({ buy: { kind: "PRICE_BELOW", level: 130 }, floor: 112, target: 175 }),
    };
    // The first call: a breakout re-anchor that pays 1.31:1.
    const first = await update(now, { entry_price: 149.6, stop_loss: 130.25, rationale: "Re-anchoring to the current base." }, 135.6);
    expect(first.refusal?.error).toBe("invalid_thesis_shape");
    expect(first.refusal?.message).not.toMatch(/set the plan down/i);
    expect(first.refusal?.message).not.toContain("remove_trigger_ids");
    // The second call, as the run made it.
    const second = await update(
      now,
      { remove_trigger_ids: ["buy", "floor", "target"], rationale: "The old plan no longer fits the tape. I am setting the plan down." },
      135.6,
    );
    expect(second.refusal?.error).toBe("buy_removed");
    expect(buysOn(second.db)).toHaveLength(1);
  });

  it("GEV, trigger run 2026-09-14 10:55 — the buy fired into bad news; passing is fine, deleting the plan is not", async () => {
    const gev = {
      ticker: "GEV", horizon: "COMPOUNDER", setupId: "MA_PULLBACK",
      entryPrice: 875, stopLoss: 690, targetPrice: 1300,
      triggers: plan({ buy: { kind: "PRICE_BELOW", level: 875 }, floor: 690, target: 1300 }),
    };
    const removed = await update(
      gev,
      { remove_trigger_ids: ["buy", "floor", "target"], rationale: "Triggered ENTER on price below $875, but I am passing: a new sell initiation is on the tape." },
      873.61,
      "INTRADAY_TACTICAL",
    );
    expect(removed.refusal?.error).toBe("buy_removed");

    const passed = await update(
      gev,
      { trigger_id: "buy", rationale: "Passing on this fire: a new sell initiation is on the tape and price broke the 200-day. The plan stands for the next cross." },
      873.61,
      "INTRADAY_TACTICAL",
    );
    expect(passed.refused).toBe(false);
    expect(buysOn(passed.db)).toHaveLength(1);
  });
});

// ── The three answers ─────────────────────────────────────────────────────

describe("the three answers land", () => {
  const etn = {
    ticker: "ETN", horizon: "COMPOUNDER", setupId: "BASE_BREAKOUT",
    entryPrice: 418, stopLoss: 355, targetPrice: 560,
    triggers: plan({ buy: { kind: "PRICE_ABOVE", level: 418 }, floor: 355, target: 560 }),
  };

  it("ETN 2026-09-23 — the run took the spent $418 buy off; that is refused", async () => {
    const { refusal } = await update(
      etn,
      { remove_trigger_ids: ["buy", "floor", "target"], rationale: "ETN's old $418 breakout buy is spent. The right action is to set this plan down." },
      442.49,
    );
    expect(refusal?.error).toBe("buy_removed");
  });

  it("REPLACE — the plan the principal's chat wrote four days later lands in one call", async () => {
    // Buy above $448 on a close, floor $387, target $575: 2.08:1.
    const { refused, db } = await update(
      etn,
      { entry_price: 448, stop_loss: 387, target_price: 575, rationale: "Re-anchored to the new base pivot at $448; floor under the base low, target the measured move." },
      439.98,
    );
    expect(refused).toBe(false);
    const buy = buysOn(db)[0];
    expect(buy.predicate).toMatchObject({ kind: "PRICE_ABOVE", level: 448 });
  });

  it("MOVE — a buy far above a broken chart is a legal plan", async () => {
    // ISRG 2026-09-23: "still not the kind of long-term repair that earns a
    // second entry" — so the buy goes where the repair would be proven.
    const isrg = {
      ticker: "ISRG", horizon: "COMPOUNDER", setupId: "BASE_BREAKOUT",
      entryPrice: 383, stopLoss: 325, targetPrice: 530,
      triggers: plan({ buy: { kind: "PRICE_ABOVE", level: 383 }, floor: 325, target: 530 }),
    };
    const { refused, db } = await update(
      isrg,
      { edit_triggers: [{ id: "buy", level: 406, rationale: "Above the $405.34 pivot — the level the repair has to clear." }], stop_loss: 345, rationale: "Moved the buy to the pivot." },
      402.09,
    );
    expect(refused).toBe(false);
    expect(buysOn(db)[0].predicate).toMatchObject({ level: 406 });
  });

  it("LET IT GO — the stock leaves the watchlist with its reason", async () => {
    const { refused, db } = await update(
      etn,
      { change_status: "ARCHIVED", rationale: "No level on the base or the pullback pays 2:1 against real structure; letting ETN go." },
      442.49,
    );
    expect(refused).toBe(false);
    expect(db.store.thesis[0].status).toBe("RETIRED");
  });
});

// ── Waiting on a date: the buy may come off ───────────────────────────────

describe("a stock waiting on a date carries no buy until the date", () => {
  it("PRAX 2026-09-21 — the decision moved to December 27; more than 70 days out", async () => {
    const prax = {
      ticker: "PRAX", horizon: "CATALYST", setupId: "PRE_CATALYST", catalystDate: inDays(97),
      entryPrice: 325, stopLoss: 292, targetPrice: 500,
      triggers: plan({ buy: { kind: "PRICE_ABOVE", level: 325 }, floor: 292, target: 500 }),
    };
    const { refused, db } = await update(
      prax,
      { remove_trigger_ids: ["buy", "floor", "target"], rationale: "The PDUFA extension moved the decision three months; the buy comes off until the window opens." },
      300.65,
    );
    expect(refused).toBe(false);
    expect(buysOn(db)).toHaveLength(0);
  });

  it("MIRM 2026-09-21 — five days to the decision; the run-up trade is over", async () => {
    const mirm = {
      ticker: "MIRM", horizon: "CATALYST", setupId: "PRE_CATALYST", catalystDate: inDays(5),
      entryPrice: 97.5, stopLoss: 88, targetPrice: 137,
      triggers: plan({ buy: { kind: "PRICE_ABOVE", level: 97.5 }, floor: 88, target: 137 }),
    };
    const { refused, db } = await update(
      mirm,
      { remove_trigger_ids: ["buy", "floor", "target"], rationale: "Not a disciplined pre-event entry five days out." },
      91.83,
    );
    expect(refused).toBe(false);
    expect(buysOn(db)).toHaveLength(0);
  });

  it("the two flags no longer give opposite orders inside the last three weeks", () => {
    const row = { status: "WATCHING", direction: "LONG", entryPrice: null, targetPrice: null, stopLoss: null, currentPrice: null, setupId: "PRE_CATALYST", horizon: "CATALYST", catalystDate: inDays(5) };
    expect(waitingOnADate(row)).toBe("WINDOW_CLOSED");
    // No buy: it waits. It is not told "the buying window is open".
    expect(computePlanSanity({ ...row, hasEnterTrigger: false }).map((f) => f.kind)).not.toContain("NO_BUY_LEVEL");
    // A buy still on: that is the one flag, as before.
    expect(computePlanSanity({ ...row, hasEnterTrigger: true }).map((f) => f.kind)).toContain("BUY_INSIDE_CUTOFF");
    // Inside the window, 47 days out, no buy: flagged, as before.
    expect(
      computePlanSanity({ ...row, catalystDate: inDays(47), hasEnterTrigger: false }).map((f) => f.kind),
    ).toContain("NO_BUY_LEVEL");
  });
});

// ── Who the rule is for ───────────────────────────────────────────────────

describe("the rule binds runs and writers, nobody else", () => {
  const before = plan({ buy: { kind: "PRICE_ABOVE", level: 100 }, floor: 90, target: 130 });
  const after = before.filter((t) => t.id === "clock");

  it("the principal's own edit, a fill and the automatic set-down are not touched", () => {
    for (const actor of ["PRINCIPAL", "SYSTEM"] as const) {
      expect(checkLadder({ triggers: after, direction: "LONG", status: "WATCHING", actor, before }).ok).toBe(true);
    }
    expect(checkLadder({ triggers: after, direction: "LONG", status: "WATCHING", actor: "AGENT", before })).toMatchObject({
      ok: false,
      error: "buy_removed",
    });
  });

  it("a stock kept on watch with no view has no plan to lose", async () => {
    // SMMT and COGT: a pass kept on watch, direction null, a wake.
    const wake = { id: "w1", predicate: { kind: "PRICE_BELOW", level: 14.82 }, action: "REVIEW", rationale: "Pullback — look again.", source: "AGENT" };
    const { refused } = await update(
      { ticker: "SMMT", direction: null, entryPrice: null, stopLoss: null, targetPrice: null, triggers: [wake], catalystDate: inDays(47) },
      { edit_triggers: [{ id: "w1", level: 14, rationale: "Lower wake after the week's range." }], rationale: "Moved the wake." },
      16.2,
      "PRINCIPAL_CHAT",
    );
    expect(refused).toBe(false);
  });

  it("a stock we hold is not a watched stock", () => {
    expect(validateBuyKept({ direction: "LONG", status: "HOLDING", before, after }).ok).toBe(true);
  });
});

// ── The thirteen, as a table ──────────────────────────────────────────────

describe("the thirteen removals of the last thirty days, under the rule", () => {
  it("ten would have been refused; three were stocks waiting on a date", () => {
    // The rows of the query in the header, one line each.
    const asOf = (iso: string) => new Date(`${iso}T12:00:00Z`);
    const rows: Array<[string, string, string | null, string, string | null, boolean]> = [
      // stock, day of the removal, setup, horizon, event date, refused?
      ["MSFT", "2026-09-14", null, "COMPOUNDER", null, true],
      ["GEV", "2026-09-14", "MA_PULLBACK", "COMPOUNDER", null, true],
      ["HPE", "2026-09-15", "PEAD", "TARGET", null, true],
      ["DOCU", "2026-09-15", "PEAD", "TARGET", null, true],
      ["MIRM", "2026-09-21", "PRE_CATALYST", "CATALYST", "2026-09-26", false],
      ["PRAX", "2026-09-21", "PRE_CATALYST", "CATALYST", "2026-12-27", false],
      ["CYTK", "2026-09-21", "NONE", "CATALYST", "2026-11-14", true],
      ["PRAX", "2026-09-23", "PRE_CATALYST", "CATALYST", "2026-12-27", false],
      ["ETN", "2026-09-23", "BASE_BREAKOUT", "COMPOUNDER", null, true],
      ["ISRG", "2026-09-23", "BASE_BREAKOUT", "COMPOUNDER", null, true],
      ["EME", "2026-09-25", "BASE_BREAKOUT", "COMPOUNDER", null, true],
      ["CYTK", "2026-09-28", "NONE", "CATALYST", "2026-11-14", true],
      ["NOW", "2026-09-28", "MA_PULLBACK", "COMPOUNDER", null, true],
    ];
    const before = plan({ buy: { kind: "PRICE_ABOVE", level: 100 }, floor: 90, target: 130 });
    const after: Trigger[] = [];
    const got = rows.map(([stock, day, setupId, horizon, event]) => {
      const waiting = waitingOnADate({ setupId, horizon, catalystDate: event ? new Date(`${event}T00:00:00Z`) : null }, asOf(day));
      return [stock, day, !validateBuyKept({ direction: "LONG", status: "WATCHING", before, after, waitingOn: waiting }).ok];
    });
    expect(got).toEqual(rows.map(([stock, day, , , , refused]) => [stock, day, refused]));
    expect(got).toHaveLength(13);
    expect(got.filter(([, , refused]) => refused)).toHaveLength(10);
  });
});
