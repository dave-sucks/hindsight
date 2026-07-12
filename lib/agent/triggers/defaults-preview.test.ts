/**
 * defaults-preview.test.ts — pins the DERIVATION logic of the "Analyst
 * Trigger Defaults" card (GAPS P1-33), not the tunable constants.
 *
 * The card promises "can never drift from code": everything it shows is
 * read off defaultTriggersForHorizon() output. So the tests assert shape
 * (which rung families appear, which per-horizon behaviors are detected)
 * with pattern matches, NOT exact percentages — the PROTECT_* constants
 * are principal-tunable and changing them must NOT break this suite.
 */

import { buildTriggerDefaultsView } from "./defaults-preview";

describe("buildTriggerDefaultsView — 'Every holding carries'", () => {
  const view = buildTriggerDefaultsView();
  const flat = view.everyHolding.flatMap((g) =>
    g.rungs.map((r) => `${g.group} · ${r.sentence}`),
  );

  it("derives the standing protection rungs from the HELD templates", () => {
    // Gain checkpoint (REVIEW), loser attention (REVIEW), trailing ratchet (EXIT).
    expect(flat).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Review if · Up \d+% from entry$/),
        expect.stringMatching(/^Review if · Down \d+% from entry$/),
        expect.stringMatching(/^Exit if · Gives back \d+% from the high$/),
      ]),
    );
  });

  it("derives both scale-in rungs (strength + pullback adds)", () => {
    expect(flat).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Add if · Price up \d+% over 1D$/),
        expect.stringMatching(/^Add if · Price down \d+% over 1D$/),
      ]),
    );
  });

  it("dedupes across horizons by merge bucket (exactly 5 standing rungs)", () => {
    expect(flat).toHaveLength(5);
  });

  it("carries the template rationale for every pill's tooltip", () => {
    for (const g of view.everyHolding) {
      for (const r of g.rungs) {
        expect(r.rationale.length).toBeGreaterThan(0);
      }
    }
  });

  it("never leaks the representative shape's fake price levels", () => {
    for (const s of flat) {
      expect(s).not.toMatch(/\$/);
    }
  });
});

describe("buildTriggerDefaultsView — horizon notes", () => {
  const view = buildTriggerDefaultsView();
  const note = (h: string) =>
    view.horizonNotes.find((n) => n.horizon === h)!.note;

  it("emits one note per horizon", () => {
    expect(view.horizonNotes.map((n) => n.horizon)).toEqual([
      "CATALYST",
      "TRADE",
      "TARGET",
      "COMPOUNDER",
    ]);
  });

  it("TRADE — auto-takes at target, max-hold review, no pullback-add", () => {
    // The first phrase gets sentence-cased, so match case-insensitively.
    expect(note("TRADE")).toMatch(/takes profit at target automatically/i);
    expect(note("TRADE")).toMatch(/\d+-day scheduled review/);
    expect(note("TRADE")).toContain("no pullback-add");
  });

  it("TARGET — reviews at target instead of auto-taking", () => {
    expect(note("TARGET")).toMatch(/reviews at target/i);
    expect(note("TARGET")).not.toMatch(/takes profit at target/i);
  });

  it("CATALYST — filing + earnings reviews, no scheduled-review rung", () => {
    expect(note("CATALYST")).toContain("filings");
    expect(note("CATALYST")).toContain("earnings surprises");
    expect(note("CATALYST")).not.toMatch(/\d+-day scheduled review/);
  });

  it("COMPOUNDER — guidance-cut review + drop-from-entry review", () => {
    expect(note("COMPOUNDER")).toContain("guidance cuts");
    expect(note("COMPOUNDER")).toContain("reviews a sharp drop from entry");
    expect(note("COMPOUNDER")).toMatch(/\d+-day scheduled review/);
  });

  it("every horizon exits at the hard stop", () => {
    for (const n of view.horizonNotes) {
      expect(n.note).toMatch(/exits at the hard stop/i);
    }
  });
});

describe("buildTriggerDefaultsView — watching note", () => {
  it("present while WATCHING templates have ENTER and no EXIT", () => {
    const view = buildTriggerDefaultsView();
    expect(view.watchingNote).toBeTruthy();
    expect(view.watchingNote).toContain("no exit or protection rungs");
  });
});
