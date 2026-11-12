/**
 * The only money the digest's model is given is the account's cash. On Nov 11
 * it was also given the margin buying power, "idle cash", the slots and
 * "fully deployed", and it wrote "leaving substantial idle cash and buying
 * power unused" and urged "more aggressive deployment". Through
 * writeDigestNarrative, with only OpenAI stood in for; stand-in amounts
 * (digest-facts-standin.ts).
 */
const sent: Array<{ messages: Array<{ content: string }> }> = [];
let reply: () => Promise<unknown> = async () => ({ choices: [{ message: { content: "A digest." } }] });
jest.mock("openai", () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: async (body: { messages: Array<{ content: string }> }) => (sent.push(body), reply()) } };
  },
}));

import { writeDigestNarrative } from "./digest-writer";
import { STANDIN_FACTS } from "@/lib/agent/__fixtures__/digest-facts-standin";

const OTHER_MONEY = /buying power|idle cash|fully deployed|slots/i;

beforeEach(() => (sent.length = 0));

describe("the digest and the account's cash", () => {
  it("is given the cash and its share of the account, and no other money", async () => {
    await writeDigestNarrative(STANDIN_FACTS);
    const [system, input] = sent[0].messages.map((m) => m.content);
    expect(input).toContain("BOOK: equity $101,000, cash $75,000 (74.3% of the account), gross exposure $26,000");
    expect(input).toContain("CADENCE: days since last new entry=3, pending proposals=0.");
    expect(input).not.toMatch(OTHER_MONEY);
    expect(input).not.toContain("150,000");
    expect(system).not.toMatch(OTHER_MONEY);
  });

  it("the plain-facts fallback says the cash, and no other money", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    reply = async () => {
      throw new Error("503");
    };
    const out = await writeDigestNarrative(STANDIN_FACTS);
    expect(out.narrative).toContain("Cash $75,000.");
    expect(out.narrative).not.toMatch(OTHER_MONEY);
  });
});
