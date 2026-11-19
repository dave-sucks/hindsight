/**
 * The morning cron's retry is seeded with the run's own messages, so it knows
 * what the run already did. On 2026-11-19 (run cmwnk6nh1000j08jj98pjtptw) the
 * seed was refused, "Invalid prompt: The messages do not match the
 * ModelMessage[] schema", and the retry ran with no history: it sent DOYU and
 * CPA to the Writer again. The thread saved from the same run, which is JSON,
 * passes the check. A tool's output as execute() returned it can hold a Date
 * (a Prisma row's createdAt), and the check refuses a Date.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { modelMessageSchema, type ModelMessage } from "ai";
import { asJsonMessages } from "./run-thread";

// A get_theses result as the SDK hands it back: the row's dates are Prisma's Date objects.
const seed: ModelMessage[] = [
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "call_1", toolName: "get_theses", input: { tickers: ["DOYU"] } }] },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "get_theses",
        output: { type: "json", value: { ok: true, data: { theses: [{ ticker: "DOYU", status: "WATCHING", createdAt: new Date("2026-11-18T19:30:42Z") }] } } as never },
      },
    ],
  },
];

describe("the retry's seed carries the run's history", () => {
  it("as the SDK hands it back, a Date in a tool's output fails the prompt check", () => {
    expect(seed.every((m) => modelMessageSchema.safeParse(m).success)).toBe(false);
  });

  it("as JSON, the way the thread is saved, it passes, the date kept as its ISO string", () => {
    const json = asJsonMessages(seed);
    expect(json.every((m) => modelMessageSchema.safeParse(m).success)).toBe(true);
    expect(JSON.stringify(json)).toContain('"createdAt":"2026-11-18T19:30:42.000Z"');
  });

  it("a BigInt (an analyst's market-cap band) becomes its digits instead of throwing", () => {
    expect(asJsonMessages([{ n: BigInt("2000000000") }])).toEqual([{ n: "2000000000" }]);
  });
});
