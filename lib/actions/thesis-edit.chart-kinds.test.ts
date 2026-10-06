/**
 * thesis-edit.chart-kinds.test.ts — every chart condition the Add-trigger
 * dialog can post is accepted by the write path, on a watch and at the
 * account/analyst level (DAV-247). The shapes below are exactly what
 * AddTriggerDialog's chartPredicate() builds.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { applyTriggerAdd, buildPrincipalTrigger } from "./thesis-edit";
import { addLevelTrigger } from "./level-triggers";
import { addProblem, conditionSentence, isLevel, type When } from "@/lib/agent/triggers/condition";


const DIALOG_POSTS: When[] = [
  { watch: "move", is: "near", value: 2, variable: "sma50" },
  { watch: "price", is: "above", variable: "sma200" },
  { watch: "price", is: "above", variable: "high52" },
  { watch: "move", is: "near", value: 5, variable: "high52" },
  { watch: "volume", value: 1.5 },
  { watch: "gap", value: 8, settings: { volume: 3 } },
  { watch: "rsi", is: "below", value: 10, settings: { period: 2 } },
  { watch: "strength", value: 0, settings: { window: "3M" } },
  { watch: "insiders", value: 3, settings: { days: 30 } },
  { watch: "price", is: "above", value: 517.88, settings: { close: true } },
  { watch: "move", is: "below", value: 8, variable: "close_5d" },
];

describe("the Add-trigger dialog's chart conditions", () => {
  it.each(DIALOG_POSTS.map((p) => [conditionSentence(p), p] as const))("%s is addable from the sheet", (_k, p) => {
    expect(addProblem(p, "THESIS")).toBeNull();
    const t = buildPrincipalTrigger({
      action: isLevel(p) ? "ENTER" : "REVIEW",
      predicate: p,
      defaultRationale: "test",
      allowDirect: false,
    });
    expect(t.predicate).toEqual(p);
    expect(t.source).toBe("PRINCIPAL");
    expect(t.cooldownDays).toBeGreaterThan(0);
  });

  it("the chart conditions can also be account / analyst standing rules; a typed price can't", () => {
    for (const p of DIALOG_POSTS) {
      expect({ p: conditionSentence(p), problem: addProblem(p, "ANALYST") }).toEqual({
        p: conditionSentence(p),
        problem: isLevel(p) ? expect.stringMatching(/same thing on every stock/) : null,
      });
    }
  });

  it("a deleted kind is refused by the schema", () => {
    expect(() =>
      buildPrincipalTrigger({
        action: "REVIEW",
        predicate: { kind: "FILING", formType: "8-K" } as unknown as When,
        defaultRationale: "test",
        allowDirect: false,
      }),
    ).toThrow(/Invalid trigger/);
  });

  // DAV-281 — "a beat the market sold", the trigger a PEAD fill writes, built
  // by hand. On main both write paths stop at the first line: the sheet says
  // "can't be added from the sheet (got AND)", the level says it is
  // "specific to one thesis".
  const BEAT_THE_MARKET_SOLD: When = { match: "all", conditions: [{ watch: "surprise", is: "beat", value: 0 }, { watch: "move", is: "below", value: 3, variable: "prev_close" }] };
  const ctx = { userId: "u1", accountId: "a1", actorUserId: "u1" } as never;

  it("a beat and a miss are conditions the dialog can post, on a stock and as a standing rule", () => {
    for (const is of ["beat", "miss"] as const) {
      const result: When = { watch: "surprise", is, value: 0 };
      expect(addProblem(result, "THESIS")).toBeNull();
      expect(addProblem(result, "ANALYST")).toBeNull();
    }
    const t = buildPrincipalTrigger({ action: "REVIEW", predicate: BEAT_THE_MARKET_SOLD, defaultRationale: "test", allowDirect: false });
    expect(t.predicate).toEqual(BEAT_THE_MARKET_SOLD);
  });

  it("the sheet's add path lets the pair past its kind check (it fails later only because this test has no database)", async () => {
    await expect(applyTriggerAdd("t1", { action: "REVIEW", predicate: BEAT_THE_MARKET_SOLD }, ctx)).rejects.not.toThrow(/can't be added/);
  });

  it("the account / analyst add path lets the pair past its eligibility check", async () => {
    await expect(addLevelTrigger("ACCOUNT", "a1", { action: "REVIEW", predicate: BEAT_THE_MARKET_SOLD }, ctx)).rejects.not.toThrow(/specific to one thesis|can't be added/);
  });

  it("a pair holding a price level is still refused as a standing rule", async () => {
    const p: When = { match: "all", conditions: [{ watch: "surprise", is: "beat", value: 0 }, { watch: "price", is: "below", value: 96 }] };
    await expect(addLevelTrigger("ACCOUNT", "a1", { action: "REVIEW", predicate: p }, ctx)).rejects.toThrow(/same thing on every stock/);
  });
});

// DAV-279 — the Catalyst seat's rules are day counts from the event date.
describe("a day count as a standing rule", () => {
  it("a day count is level-eligible, so 'review 10 days before the event date' can be an analyst rule", () => {
    expect(addProblem({ watch: "from_date", is: "before", value: 10, variable: "event" }, "ANALYST")).toBeNull();
  });
});
