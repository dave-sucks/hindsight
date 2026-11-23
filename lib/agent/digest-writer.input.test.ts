/**
 * The digest's model is given the portfolio snapshot (and, on a day the
 * Portfolio Manager ran, its write-up: digest-writer.evening.test.ts): no run
 * logs, no ids, no borrowing money. On Nov 11 it was given every run's id and
 * "status COMPLETE", every quiet review, two buy proposals listed as trades,
 * and the margin buying power, and it urged "more aggressive deployment".
 * Through writeDigestNarrative on the agent runner, with only OpenAI's
 * endpoint stood in for; stand-in
 * amounts (portfolio-snapshot-standin.ts).
 */
// No run: nothing is kept.
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

const sent: Array<{ messages: Array<{ role: string; content: string }> }> = [];
let reply: () => Response = () =>
  new Response(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "gpt-5.4", choices: [{ index: 0, message: { role: "assistant", content: "A digest." }, finish_reason: "stop" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const realFetch = globalThis.fetch;
beforeAll(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async (_url: string, init?: RequestInit) => (sent.push(JSON.parse(String(init?.body))), reply())) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

import { writeDigestNarrative } from "./digest-writer";
import { snapshotText } from "@/lib/portfolio/snapshot";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";

beforeEach(() => (sent.length = 0));

describe("what the digest's model is given", () => {
  it("is its instructions, then the date line and the snapshot's text, exactly", async () => {
    await writeDigestNarrative(STANDIN_SNAPSHOT);
    expect(sent).toHaveLength(1);
    expect(sent[0].messages.map((m) => m.role)).toEqual(["developer", "user"]);
    expect(sent[0].messages[1].content).toBe(`Wed, Nov 11, 2026, 8:00 PM ET, the PAPER account.\n\n## Market and portfolio\n\n### Portfolio snapshot\n${snapshotText(STANDIN_SNAPSHOT)}`);
  });

  it("the instructions ask for the day, the trades and each proposal's reason with no view of its own, and never for deploying cash", async () => {
    await writeDigestNarrative(STANDIN_SNAPSHOT);
    const system = sent[0].messages[0].content;
    expect(system).toContain("A proposal is not a trade until the owner approves it.");
    expect(system).toContain("Never name a new price level for a stock.");
    expect(system).toContain("Add no view of your own on whether to approve it.");
    expect(system).not.toContain("would you approve");
    expect(system).toContain("never suggest what to do with it");
    expect(system).not.toMatch(/buying power|idle cash|deploy|slots|thesis:|analyst:|run:/i);
  });

  it("when the model writes nothing, the digest is the snapshot's account lines", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    reply = () => new Response(JSON.stringify({ error: { message: "Bad request" } }), { status: 400, headers: { "content-type": "application/json" } });
    const out = await writeDigestNarrative(STANDIN_SNAPSHOT);
    expect(out.model).toBe("fallback");
    expect(out.narrative).toBe(
      "Value $80,000.00 · cash $40,000.00 (50.0% of the account)\n\nWed, Nov 11: +0.6% (+$500) · since the start: −20.0% (−$20,000) on $100,000 put in\n\n2 proposals are waiting for your approval.",
    );
  });
});
