/**
 * setup-time-unit.test.ts — a setup's time limit is counted in the unit the
 * playbook wrote it in.
 *
 * The catalog's short clocks are sessions ("no progress in 10–20 sessions is
 * a failed breakout"); the 60-day checkpoints are calendar days ("a 60-day
 * business checkpoint" is two months of the company's life). A trigger's day
 * count from the buy is always calendar days, so the sessions are converted
 * in ONE place — `setupExitTriggers`, at the moment the fill writes them —
 * against the real NYSE calendar.
 *
 * Before this, every session count was written straight through as calendar
 * days, so each short review fired about 30% early: the weekends inside the
 * window were spent as if the market had been open.
 *
 * Replay from the live book: ABT, bought 2026-09-11 on the pullback-to-a-
 * rising-average setup, whose limit is 10 sessions.
 */
import { setupExitTriggers } from "./setup-exits";
import { getSetup } from "@/lib/agent/knowledge/setups";
import { sessionsToCalendarDays } from "@/lib/market-hours";

const timeTrigger = (setupId: string, horizon: string, boughtAt: string) =>
  setupExitTriggers({
    setup: getSetup(setupId)!,
    horizon,
    entry: 103.663,
    stop: 98,
    mintId: () => "x",
    boughtAt: new Date(boughtAt),
  }).find((t) => t.predicate.kind === "REVIEW_CADENCE");

describe("a setup's time limit is counted in its own unit", () => {
  it("ABT: 10 sessions from the 2026-09-11 buy is 14 calendar days, not 10", () => {
    const t = timeTrigger("MA_PULLBACK", "COMPOUNDER", "2026-09-11T17:36:00.482Z");
    expect(t?.predicate).toEqual({ kind: "REVIEW_CADENCE", days: 14, from: "BUY" });
    // The old behaviour wrote 10, which lands on 2026-09-21 — session five of
    // the ten the setup asks for. The review is now due 2026-09-25.
    expect(t?.cooldownDays).toBe(14);
  });

  it("the sentence names both units, so the next reader can see which is which", () => {
    const t = timeTrigger("MA_PULLBACK", "COMPOUNDER", "2026-09-11T17:36:00.482Z");
    expect(t?.rationale).toContain("10 sessions after the buy");
    expect(t?.rationale).toContain("14 calendar days from this one");
  });

  it("a calendar checkpoint is untouched — only the short clocks move", () => {
    // FIVE, bought 2026-09-10 on PEAD, whose limit is the 60-day business
    // checkpoint. Sixty means sixty.
    const t = timeTrigger("PEAD", "TARGET", "2026-09-10T19:57:17.215Z");
    expect(t?.predicate).toEqual({ kind: "REVIEW_CADENCE", days: 60, from: "BUY" });
    expect(t?.rationale).toContain("60 days after the buy");
    expect(t?.rationale).not.toContain("sessions after the buy");
  });

  it("a setup with no time limit still writes none", () => {
    expect(timeTrigger("ESTIMATE_REVISION", "TARGET", "2026-09-11T00:00:00Z")).toBeUndefined();
  });
});

describe("sessionsToCalendarDays walks the real calendar", () => {
  it("a plain week: 5 sessions from a Friday is 7 days", () => {
    expect(sessionsToCalendarDays(5, new Date("2026-09-11T12:00:00Z"))).toBe(7);
  });

  it("Thanksgiving week costs an extra day", () => {
    // From Friday 2026-11-20: Nov 23, 24 and 25 are sessions, Nov 26 is
    // Thanksgiving, and Nov 27 is a half day that still trades — so the
    // fourth session is Nov 27, seven days out. The fifth is Monday Nov 30,
    // ten days out, where an ordinary week would have put it at seven.
    expect(sessionsToCalendarDays(4, new Date("2026-11-20T12:00:00Z"))).toBe(7);
    expect(sessionsToCalendarDays(5, new Date("2026-11-20T12:00:00Z"))).toBe(10);
  });

  it("Good Friday is not a session", () => {
    // Easter 2026 is April 5, so Good Friday is April 3. From Monday March
    // 30: Mar 31, Apr 1, 2 are sessions; Apr 3 is not; the fourth session is
    // Monday April 6.
    expect(sessionsToCalendarDays(4, new Date("2026-03-30T12:00:00Z"))).toBe(7);
  });

  it("zero or nonsense asks for no days at all", () => {
    expect(sessionsToCalendarDays(0, new Date("2026-09-11T12:00:00Z"))).toBe(0);
    expect(sessionsToCalendarDays(-3, new Date("2026-09-11T12:00:00Z"))).toBe(0);
    expect(sessionsToCalendarDays(NaN, new Date("2026-09-11T12:00:00Z"))).toBe(0);
  });
});
