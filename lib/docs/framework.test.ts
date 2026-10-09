/**
 * framework.test.ts — /docs/framework measures every door from the code, and
 * a measurement that throws is left out rather than failing the page. This
 * checks that every number is actually taken, so a blank never ships.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { buildFrameworkData } from "./framework";

describe("the framework page's measurements", () => {
  const data = buildFrameworkData();

  it("measures every door's prompt", () => {
    for (const d of data.doors) expect(d.promptChars).toBeGreaterThan(1_000);
  });

  it("measures the tool menu of every door that sends one", () => {
    for (const d of data.doors.filter((x) => x.id !== "writer")) {
      expect(d.toolChars).toBeGreaterThan(5_000);
      expect(d.tools.length).toBeGreaterThan(3);
    }
  });

  it("finds the house rules in the three doors that carry them", () => {
    const carries = Object.fromEntries(data.doors.map((d) => [d.id, d.houseRules]));
    expect(carries).toMatchObject({ morning: true, trigger: true, chat: true });
  });

  it("reads all sixteen situation texts", () => {
    expect(data.situations).toHaveLength(16);
    for (const s of data.situations) expect(s.chars).toBeGreaterThan(50);
  });
});
