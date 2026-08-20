/**
 * buildHeldThroughNote — the plain-language paragraph appended to a
 * no-agent (DIRECT) sell proposal on a held-through stock (DAV-194). The
 * point of the feature is that the daily card is never verbatim-identical:
 * the note names the decline count, quotes the principal's reject note,
 * and suggests where the line could go.
 */

// Only the pure composer is under test — stub the heavy transitive imports
// (generated Prisma client can't load under jest's CJS transform).
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/alpaca", () => ({ getBars: jest.fn() }));

import { buildHeldThroughNote } from "./held-through-context";

describe("buildHeldThroughNote", () => {
  it("returns null on the first ask (nothing held-through to say)", () => {
    expect(
      buildHeldThroughNote({
        declineCount: 0,
        rejectMessage: null,
        recentExtreme: null,
        direction: "LONG",
      }),
    ).toBeNull();
  });

  it("names the decline count, quotes the reject note, suggests below the recent low", () => {
    const note = buildHeldThroughNote({
      declineCount: 3,
      rejectMessage: "holding through earnings, story intact",
      recentExtreme: 921.5,
      direction: "LONG",
    });
    expect(note).toContain("3 declines");
    expect(note).toContain('"holding through earnings, story intact"');
    expect(note).toContain("$921.50");
    expect(note).toContain("just below");
  });

  it("uses singular wording for one prior decline", () => {
    const note = buildHeldThroughNote({
      declineCount: 1,
      rejectMessage: null,
      recentExtreme: null,
      direction: "LONG",
    });
    expect(note).toContain("1 decline or expiry");
    expect(note).not.toContain("declines");
  });

  it("suggests above the recent high for SHORT positions", () => {
    const note = buildHeldThroughNote({
      declineCount: 2,
      rejectMessage: null,
      recentExtreme: 55.25,
      direction: "SHORT",
    });
    expect(note).toContain("Recent high $55.25");
    expect(note).toContain("just above");
  });

  it("omits the level suggestion when bars were unavailable", () => {
    const note = buildHeldThroughNote({
      declineCount: 2,
      rejectMessage: "note",
      recentExtreme: null,
      direction: "LONG",
    });
    expect(note).not.toContain("Recent low");
    expect(note).toContain("2 declines");
  });

  it("truncates very long reject notes", () => {
    const note = buildHeldThroughNote({
      declineCount: 2,
      rejectMessage: "x".repeat(500),
      recentExtreme: null,
      direction: "LONG",
    });
    expect(note!.length).toBeLessThan(450);
  });
});
