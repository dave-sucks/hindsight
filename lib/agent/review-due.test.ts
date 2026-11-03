/**
 * review-due.test.ts — the review clock, due: one reading for the work
 * list's REVIEW_DUE and for the morning run's save, which links a note to
 * the clock when nothing fired (2026-11-03).
 */
import { reviewDue } from "@/lib/agent/needs-action";
import type { Trigger } from "@/lib/agent/triggers/types";

const now = new Date("2026-11-03T13:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const clock = (id: string, days: number): Trigger => ({ id, action: "REVIEW", predicate: { watch: "repeat", value: days }, rationale: "" } as Trigger);
const floor: Trigger = { id: "floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 236 }, rationale: "" } as Trigger;

describe("reviewDue", () => {
  it("names the clock and the days overdue once the cadence has elapsed", () => {
    expect(reviewDue({ triggers: [floor, clock("c7", 7)], lastReviewedAt: ago(11), createdAt: ago(60) }, now)).toEqual({ triggerId: "c7", clockDays: 7, daysOverdue: 4 });
  });
  it("counts a review coming due within the day as due today (the 8 AM run must catch a 9:30 review)", () => {
    expect(reviewDue({ triggers: [clock("c7", 7)], lastReviewedAt: ago(6.5), createdAt: ago(60) }, now)).toEqual({ triggerId: "c7", clockDays: 7, daysOverdue: 0 });
  });
  it("is null before the clock runs out, and with no clock at all", () => {
    expect(reviewDue({ triggers: [clock("c7", 7)], lastReviewedAt: ago(3), createdAt: ago(60) }, now)).toBeNull();
    expect(reviewDue({ triggers: [floor], lastReviewedAt: ago(90), createdAt: ago(100) }, now)).toBeNull();
  });
  it("a stock never reviewed counts from its creation; the first clock on the list decides", () => {
    expect(reviewDue({ triggers: [clock("own", 30), clock("inherited", 7)], lastReviewedAt: null, createdAt: ago(10) }, now)).toBeNull();
    expect(reviewDue({ triggers: [clock("own", 30), clock("inherited", 7)], lastReviewedAt: null, createdAt: ago(31) }, now)?.triggerId).toBe("own");
  });
});
