/**
 * The review's edge values: each was fine in the form and refused by the save
 * with "Not a condition this app can check", so the owner and the agents got
 * the same opaque line. Now the save, the agents' schema and the form refuse
 * with one sentence from the measure, naming the number and its range, and
 * the value just inside the range saves everywhere.
 */
import { predicateInputSchema, triggerPredicateSchema } from "../schema";
import { conditionProblem } from "./check";
import type { Condition } from "./types";

const held = { level: "THESIS" as const, held: true };

const cases: Array<{ name: string; refused: Condition; says: RegExp; inside: Condition }> = [
  {
    name: "within 15% of the 50-day",
    refused: { watch: "move", is: "near", value: 15, variable: "sma50" },
    says: /up to 10%; 15% isn't/,
    inside: { watch: "move", is: "near", value: 10, variable: "sma50" },
  },
  {
    name: "a 0.5% trail",
    refused: { watch: "move", is: "below", value: 0.5, variable: "peak" },
    says: /at least 1%; 0\.5%/,
    inside: { watch: "move", is: "below", value: 1, variable: "peak" },
  },
  {
    name: "the report day, as days before it",
    refused: { watch: "report", is: "before", value: 0 },
    says: /1 to 14 whole days.*; 0 isn't\. For the report day itself, use after, from day 0\./,
    inside: { watch: "report", is: "after", value: 0, settings: { fromDay: 0 } },
  },
  {
    name: "7 days after earnings",
    refused: { watch: "report", is: "after", value: 7 },
    says: /0 to 5 whole days.*; 7 isn't/,
    inside: { watch: "report", is: "after", value: 5 },
  },
  {
    name: "volume 60×",
    refused: { watch: "volume", value: 60 },
    says: /up to 50× normal; 60× isn't/,
    inside: { watch: "volume", value: 50 },
  },
  {
    name: "12 insiders",
    refused: { watch: "insiders", value: 12 },
    says: /1 to 10 whole insiders; 12 isn't/,
    inside: { watch: "insiders", value: 10 },
  },
  {
    name: "every 400 days",
    refused: { watch: "repeat", value: 400 },
    says: /1 to 365 whole days; 400 isn't/,
    inside: { watch: "repeat", value: 365 },
  },
  {
    name: "a gap within 12 days",
    refused: { watch: "gap", value: 4, settings: { withinDays: 12 } },
    says: /1 to 10 whole sessions.*; 12 isn't/,
    inside: { watch: "gap", value: 4, settings: { withinDays: 10 } },
  },
];

describe("a refusal names the number, and the form and the save agree", () => {
  it.each(cases)("$name", ({ refused, says, inside }) => {
    const save = triggerPredicateSchema.safeParse(refused);
    expect(save.success).toBe(false);
    const message = save.error?.issues[0]?.message ?? "";
    expect(message).toMatch(says);

    const agent = predicateInputSchema().safeParse(refused);
    expect(agent.success).toBe(false);
    expect(agent.error?.issues[0]?.message).toBe(message);

    expect(conditionProblem(refused, held)).toBe(message);

    // Just inside the range, all three accept it.
    expect(triggerPredicateSchema.safeParse(inside).success).toBe(true);
    expect(predicateInputSchema().safeParse(inside).success).toBe(true);
    expect(conditionProblem(inside, held)).toBeNull();
  });
});
