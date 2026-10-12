/**
 * The form, the save and the agents' schema refuse the same number with the
 * same sentence, because all three read the range off the catalog
 * (./range). The cases are the review's: the edge values, the three the save
 * used to accept ($0, a negative price, a fall of 150%), and the conditions
 * whose answer must be the same everywhere. For each refusal, the value just
 * inside the range saves everywhere.
 */
import { predicateInputSchema, triggerPredicateSchema } from "../schema";
import { conditionProblem } from "./check";
import type { Condition } from "./types";

const held = { level: "THESIS" as const, held: true };

/** The agents write a price's line, or a filing, in `value`. */
function asAgent(c: Condition): unknown {
  if ((c.watch === "price" || c.watch === "filing") && c.variable) {
    const { variable, ...rest } = c;
    return { ...rest, value: variable };
  }
  return c;
}

const refused: Array<{ name: string; c: Condition; says: RegExp; inside: Condition }> = [
  {
    name: "within 15% of the 50-day",
    c: { watch: "move", is: "near", value: 15, variable: "sma50" },
    says: /^Within an average takes more than 0% and up to 10%; 15% isn't\.$/,
    inside: { watch: "move", is: "near", value: 10, variable: "sma50" },
  },
  {
    name: "a 0.5% trail",
    c: { watch: "move", is: "below", value: 0.5, variable: "peak" },
    says: /^A trail takes 1% or more and under 100%; 0\.5% isn't\. Under 1% fires on noise/,
    inside: { watch: "move", is: "below", value: 1, variable: "peak" },
  },
  {
    name: "the report day, as days before it",
    c: { watch: "report", is: "before", value: 0 },
    says: /^Before earnings takes a whole number from 1 to 14 days; 0 days isn't\..*use after, from day 0\.$/,
    inside: { watch: "report", is: "after", value: 0, settings: { fromDay: 0 } },
  },
  {
    name: "7 days after earnings",
    c: { watch: "report", is: "after", value: 7 },
    says: /^After earnings takes a whole number from 0 to 5 days; 7 days isn't\./,
    inside: { watch: "report", is: "after", value: 5 },
  },
  {
    name: "volume 60×",
    c: { watch: "volume", value: 60 },
    says: /^Volume takes more than 0× and up to 50×; 60× isn't\.$/,
    inside: { watch: "volume", value: 50 },
  },
  {
    name: "a 7-day RSI",
    c: { watch: "rsi", is: "below", value: 30, settings: { period: 7 } },
    says: /^`period` takes one of 14, 2; 7 isn't\. Leave `period` out unless you mean it\.$/,
    inside: { watch: "rsi", is: "below", value: 30, settings: { period: 2 } },
  },
  {
    name: "12 insiders",
    c: { watch: "insiders", value: 12 },
    says: /^Insider buying takes a whole number from 1 to 10 insiders; 12 insiders isn't\.$/,
    inside: { watch: "insiders", value: 10 },
  },
  {
    name: "every 400 days",
    c: { watch: "repeat", value: 400 },
    says: /^A repeat takes a whole number from 1 to 365 days; 400 days isn't\.$/,
    inside: { watch: "repeat", value: 365 },
  },
  {
    name: "a gap within 12 days",
    c: { watch: "gap", value: 4, settings: { withinDays: 12 } },
    says: /\(withinDays\) takes a whole number from 1 to 10 sessions; 12 sessions isn't\..*Leave `withinDays` out unless you mean it\.$/,
    inside: { watch: "gap", value: 4, settings: { withinDays: 10 } },
  },
  {
    name: "a typed $0 price",
    c: { watch: "price", is: "above", value: 0 },
    says: /^A typed price takes more than \$0; \$0 isn't\.$/,
    inside: { watch: "price", is: "above", value: 0.01 },
  },
  {
    name: "a negative price",
    c: { watch: "price", is: "below", value: -5 },
    says: /^A typed price takes more than \$0; -\$5 isn't\.$/,
    inside: { watch: "price", is: "below", value: 5 },
  },
  {
    name: "below 150% from yesterday's close",
    c: { watch: "move", is: "below", value: 150, variable: "prev_close" },
    says: /^A fall takes more than 0% and under 100%; 150% isn't\. A fall of 100% or more can't happen\.$/,
    inside: { watch: "move", is: "below", value: 99, variable: "prev_close" },
  },
  {
    name: "an average read on the close",
    c: { watch: "price", is: "above", variable: "sma50", settings: { close: true } },
    says: /only a typed price can wait for the close/,
    inside: { watch: "price", is: "above", variable: "sma50" },
  },
];

describe("a refusal names the number, and the form, the save and the agents agree", () => {
  it.each(refused)("$name", ({ c, says, inside }) => {
    const save = triggerPredicateSchema.safeParse(c);
    expect(save.success).toBe(false);
    const message = save.error?.issues[0]?.message ?? "";
    expect(message).toMatch(says);

    const agent = predicateInputSchema().safeParse(asAgent(c));
    expect(agent.success).toBe(false);
    expect(agent.error?.issues[0]?.message).toBe(message);

    expect(conditionProblem(c, held)).toBe(message);

    // Just inside the range, all three accept it.
    expect(triggerPredicateSchema.safeParse(inside).success).toBe(true);
    expect(predicateInputSchema().safeParse(asAgent(inside)).success).toBe(true);
    expect(conditionProblem(inside, held)).toBeNull();
  });
});

describe("what all three accept, and store the same way", () => {
  it.each([
    // A setting the measure doesn't take is dropped everywhere, never refused.
    { name: "a stray close on a move", c: { watch: "move", is: "below", value: 7, variable: "prev_close", settings: { close: true } }, stored: { watch: "move", is: "below", value: 7, variable: "prev_close" } },
    { name: "a stray RSI length on a price", c: { watch: "price", is: "below", value: 150, settings: { period: 14 } }, stored: { watch: "price", is: "below", value: 150 } },
    { name: "every 14 days", c: { watch: "repeat", value: 14 }, stored: { watch: "repeat", value: 14 } },
  ] as Array<{ name: string; c: Condition; stored: Condition }>)("$name", ({ c, stored }) => {
    expect(triggerPredicateSchema.parse(c)).toEqual(stored);
    expect(predicateInputSchema().parse(asAgent(c))).toEqual(stored);
    expect(conditionProblem(c, held)).toBeNull();
  });

  it("a sale below our entry is the form's to refuse on a stock we only watch; the save doesn't know who owns it", () => {
    const c: Condition = { watch: "move", is: "below", value: 8, variable: "entry" };
    expect(conditionProblem(c, { level: "THESIS", held: false })).toMatch(/only once we own the stock/);
    expect(conditionProblem(c, held)).toBeNull();
    expect(triggerPredicateSchema.safeParse(c).success).toBe(true);
  });
});

describe("an old kind from a model gets the list of measures", () => {
  it("in the agents' schema and at the save", () => {
    const old = { kind: "PRICE_BELOW", level: 90 };
    const agent = predicateInputSchema().safeParse(old);
    expect(agent.success).toBe(false);
    const said = agent.error?.issues.map((i) => i.message).join(" ") ?? "";
    expect(said).toMatch(/"kind: PRICE_BELOW" is an old trigger kind, retired/);
    expect(said).toMatch(/watch one of: price, move, volume, rsi, strength, gap, report, surprise, filing, insiders, repeat, from_date/);
    expect(triggerPredicateSchema.safeParse(old).error?.issues[0]?.message).toBe(said);
  });
});
