/**
 * The digest's model is given the portfolio snapshot and nothing else: no run
 * logs, no ids, no borrowing money. On Nov 11 it was given every run's id and
 * "status COMPLETE", every quiet review, two buy proposals listed as trades,
 * and the margin buying power, and it urged "more aggressive deployment".
 * Through writeDigestNarrative, with only OpenAI stood in for; stand-in
 * amounts (portfolio-snapshot-standin.ts).
 */
const sent: Array<{ messages: Array<{ role: string; content: string }> }> = [];
let reply: () => Promise<unknown> = async () => ({ choices: [{ message: { content: "A digest." } }] });
jest.mock("openai", () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: async (body: { messages: Array<{ role: string; content: string }> }) => (sent.push(body), reply()) } };
  },
}));

import { writeDigestNarrative } from "./digest-writer";
import { snapshotText } from "@/lib/portfolio/snapshot";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";

beforeEach(() => (sent.length = 0));

describe("what the digest's model is given", () => {
  it("is its instructions and the snapshot's text, exactly", async () => {
    await writeDigestNarrative(STANDIN_SNAPSHOT);
    expect(sent).toHaveLength(1);
    expect(sent[0].messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(sent[0].messages[1].content).toBe(snapshotText(STANDIN_SNAPSHOT));
  });

  it("the instructions ask for the day, the trades and a view on each proposal, and never for deploying cash", async () => {
    await writeDigestNarrative(STANDIN_SNAPSHOT);
    const system = sent[0].messages[0].content;
    expect(system).toContain("A proposal is not a trade until the owner approves it.");
    expect(system).toContain("Never name a new price level for a stock.");
    expect(system).toContain("would you approve it or not, and why");
    expect(system).toContain("never suggest what to do with it");
    expect(system).not.toMatch(/buying power|idle cash|deploy|slots|thesis:|analyst:|run:/i);
  });

  it("when the model writes nothing, the digest is the snapshot's account lines", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    reply = async () => {
      throw new Error("503");
    };
    const out = await writeDigestNarrative(STANDIN_SNAPSHOT);
    expect(out.model).toBe("fallback");
    expect(out.narrative).toBe(
      "Value $80,000.00 · cash $40,000.00 (50.0% of the account)\n\nWed, Nov 11: +0.6% (+$500) · since the start: −20.0% (−$20,000) on $100,000 put in\n\n2 proposals are waiting for your approval.",
    );
  });
});
