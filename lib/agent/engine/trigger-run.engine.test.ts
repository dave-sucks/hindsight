/**
 * A trigger fire wakes one of two agents (lib/agent/engine/agents): the
 * trigger run, which decides, or, on an Auto trade, the post-trade write-up.
 * Each one's own text is the same on every run; the trigger run's
 * instructions end with the stock's situations (instructions that travel
 * with the stock), and every fact about the run (the stock, the trigger, the
 * price it fired at, the trade) is a block of its first message. The cases
 * are the shapes the old builder took (./__fixtures__/trigger-run-cases.ts).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { TRIGGER_CASES, TRIGGER_KICKOFF, type TriggerCaseName } from "./__fixtures__/trigger-run-cases";
import { triggerRunRequest } from "@/lib/agent/system-prompts/intraday-tactical";
import { TRIGGER_RUN } from "./agents/trigger-run";
import { POST_TRADE_WRITEUP } from "./agents/post-trade-writeup";
import { isOwn } from "./types";
import { rowsOf } from "./__fixtures__/rows-of";

const args = (name: TriggerCaseName) => {
  const { pieces, ...rest } = TRIGGER_CASES[name] as (typeof TRIGGER_CASES)[TriggerCaseName] & { pieces?: unknown };
  return { ...(rest as never as Parameters<typeof triggerRunRequest>[0]), portfolioPieces: (pieces as never) ?? null };
};
const k = TRIGGER_KICKOFF;
const names = Object.keys(TRIGGER_CASES) as TriggerCaseName[];
const isAuto = (name: TriggerCaseName) => Boolean((TRIGGER_CASES[name] as { autoTrade?: unknown }).autoTrade);
/** The instructions without the analyst and the stock's situations: the text every run of the agent is sent. */
const fixedOf = (name: TriggerCaseName) => {
  const built = triggerRunRequest(args(name));
  let at = 0;
  let out = "";
  for (const p of built.parts.filter((x) => x.where === "instructions")) {
    at += (p.sep ?? "").length;
    if (p.id !== "situations" && p.id !== "analyst_brief") out += built.instructions.slice(at, at + p.chars);
    at += p.chars;
  }
  return out;
};

describe("a trigger fire's two agents", () => {
  it("each record's own words are one fixed text, with no part that changes by run and no separator of its own", () => {
    for (const record of [TRIGGER_RUN, POST_TRADE_WRITEUP]) {
      for (const part of [...record.instructions, ...record.message]) {
        expect([record.id, part.sep]).toEqual([record.id, undefined]);
        if (isOwn(part)) expect([record.id, part.own, typeof part.text]).toEqual([record.id, part.own, "string"]);
      }
    }
  });

  it("the fixed text is the same in every shape: the trigger run's on a decision, the write-up's on an Auto trade", () => {
    const decide = names.filter((n) => !isAuto(n)).map(fixedOf);
    const writeUp = names.filter(isAuto).map(fixedOf);
    expect(new Set(decide).size).toBe(1);
    expect(new Set(writeUp).size).toBe(1);
    expect(decide[0]).toContain("## Decision framework");
    expect(writeUp[0]).toContain("## What your note answers, in order");
    expect(writeUp[0]).not.toContain("## Decision framework");
    // Nothing about the stock or the trigger is in the fixed text.
    for (const text of [decide[0], writeUp[0]]) for (const fact of ["$CASE", "trg_", "100.60", "141.20"]) expect([fact, text.includes(fact)]).toEqual([fact, false]);
  });

  it("the first message carries the stock, the trigger with the price it fired at, and the fire's facts, then the ask", () => {
    const facts = `Tactical run on $CASE. ${k.fireSentence}.${k.contextSuffix}`;
    const msg = triggerRunRequest(args("trail_sale"), { facts }).message;
    expect(msg).toContain("## $CASE, its row (get_theses)");
    expect(msg).toContain("## The trigger that fired (id: trg_trail)\n  predicate: below 12% from the high since we bought\n  fired at: $141.20\n  declared action: EXIT");
    expect(msg).toContain("THE PEAK IS AUTHORITATIVE");
    expect(msg.indexOf("## Market and portfolio")).toBeLessThan(msg.indexOf("## $CASE, its row"));
    expect(msg.endsWith(`${facts}\n\nFind out what is going on with the company and the stock, decide, act if warranted, then write your review with update_thesis. You are running unattended — no human will respond. Every turn must call a tool; text-only turns terminate the run as FAILED.`)).toBe(true);
  });

  it("a buy's situations end its instructions and a watch's playbooks are a block of the first message, only when there are some", () => {
    const buy = triggerRunRequest(args("buy_on_watch"));
    // The last part of the instructions.
    const situations = buy.instructions.lastIndexOf("\n\n## Its situations\nThe situations $CASE is in (");
    expect(situations).toBeGreaterThan(buy.instructions.lastIndexOf("## Hard constraints"));
    expect(buy.message).not.toContain("## Its situations");
    expect(triggerRunRequest(args("trail_sale")).instructions).not.toContain("## Its situations");
    expect(triggerRunRequest(args("review_on_watch")).message).toContain("YOUR PLAYBOOKS");
    expect(triggerRunRequest(args("trail_sale")).message).not.toContain("YOUR PLAYBOOKS");
  });

  it("the write-up has no trade tools; the trigger run has them", () => {
    for (const tool of ["place_trade", "close_position", "manage_position"]) {
      expect(TRIGGER_RUN.tools).toContain(tool);
      expect(POST_TRADE_WRITEUP.tools).not.toContain(tool);
    }
    expect(POST_TRADE_WRITEUP.tools).toEqual(expect.arrayContaining(["get_stock_data", "web_search", "update_thesis"]));
  });

  it("names every part, and the parts add up to what is sent", () => {
    const built = triggerRunRequest(args("buy_on_watch"), { facts: "Tactical run on $CASE. Buy if above $120." });
    expect(rowsOf(built)?.map((r) => r.name)).toEqual([
      "The analyst",
      "Its instructions",
      "House rules",
      "How you write",
      "Its situations",
      "Market numbers",
      "The stock's row",
      "What fired",
      "The fire",
      "The ask",
    ]);
    const auto = triggerRunRequest(args("auto_sale"), { facts: "Write-up on $CASE." });
    expect(rowsOf(auto)?.map((r) => r.name)).toEqual(["The analyst", "Its instructions", "House rules", "Weighing the Market and portfolio block", "How you write", "Market numbers", "Market digest", "Portfolio snapshot", "Portfolio digest", "The stock's row", "What fired", "The fire", "The ask"]);
  });
});
