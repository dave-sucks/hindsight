/**
 * catalyst-calendar.test.ts — the sentences companies actually wrote.
 *
 * Every quote below is verbatim from the filing named beside it, captured
 * 2026-09-23. The first version of this parser got PRAX wrong: its June filing
 * announces the date *moving* — "from September 27, 2026 to December 27, 2026"
 * — and taking the first date read out the superseded one. The thesis had the
 * right date and the tool had the old one, which is the wrong way round.
 */

import { findEventDate, daysUntil, plainText } from "./catalyst-calendar";

const doc = (name: string, text: string) => [{ name, text }];

describe("the date a company announced", () => {
  it("reads a plain PDUFA sentence — MIRM, mirm-20260805xexx991.htm", () => {
    const found = findEventDate(
      doc(
        "mirm-20260805xexx991.htm",
        "<p>ossificans progressiva (FOP) at ENDO 2026 Prescription Drug User Fee Act (PDUFA) target action date for the zilurgisertib NDA is September 26, 2026.</p>",
      ),
      "PDUFA",
    );
    expect(found?.date).toBe("2026-09-26");
    expect(found?.quote).toContain("September 26, 2026");
  });

  it("takes the NEW date when the date moved — PRAX, prax-20260629.htm", () => {
    const found = findEventDate(
      doc(
        "prax-20260629.htm",
        "and SCN8A developmental and epileptic encephalopathies (DEEs), setting an updated PDUFA target action date from September 27, 2026 to December 27, 2026.",
      ),
      "PDUFA",
    );
    // The superseded date is September 27. The live one is December 27.
    expect(found?.date).toBe("2026-12-27");
  });

  it("reads the phrase written out in full — EXEL, exel-20260910.htm (the review extended, the date moved)", () => {
    const found = findEventDate(
      doc(
        "exel-20260910.htm",
        "In response to an FDA information request, Exelixis had submitted updated safety and efficacy data, which the FDA has deemed a major amendment. The updated Prescription Drug User Fee Act action date is March 3, 2027.",
      ),
      "PDUFA",
    );
    expect(found?.date).toBe("2027-03-03");
  });

  it("reads 'goal action date', not just 'target' — SMMT, a2026_prx0915xharmoniltf.htm", () => {
    const found = findEventDate(
      doc(
        "a2026_prx0915xharmoniltf.htm",
        "based on the results from the HARMONi trial and has a Prescription Drug User Fee Act (PDUFA) goal action date of November 14, 2026.",
      ),
      "PDUFA",
    );
    expect(found?.date).toBe("2026-11-14");
  });

  it("reads the date when it comes BEFORE the phrase — SRRK, srrk-ex99_1.htm", () => {
    const found = findEventDate(
      doc(
        "srrk-ex99_1.htm",
        "facilities, representing two independent paths to an FDA approval decision by September 30, 2026 Prescription Drug User Fee Act (PDUFA) date.",
      ),
      "PDUFA",
    );
    expect(found?.date).toBe("2026-09-30");
  });

  it("prefers the press release over the cover page that points at it", () => {
    const found = findEventDate(
      [
        { name: "form8k.htm", text: "Item 8.01 Other Events. The information in Exhibit 99.1 is incorporated by reference." },
        { name: "ex99-1.htm", text: "The FDA assigned a PDUFA target action date of December 3, 2026." },
      ],
      "PDUFA",
    );
    expect(found?.date).toBe("2026-12-03");
    expect(found?.url).toBe("ex99-1.htm");
  });

  it("says nothing rather than guessing when the filing carries no date", () => {
    expect(
      findEventDate(doc("ex99-1.htm", "The Company announced a PDUFA target action date will be assigned in due course."), "PDUFA"),
    ).toBeNull();
  });
});

describe("the text a person reads", () => {
  it("strips markup and the hex entities that leaked into a quote", () => {
    // COGT's milestone list arrived as "&#x2022;" bullets mid-sentence.
    expect(plainText("<p>Upcoming Milestones &#x2022; Potential FDA approval &amp; launch</p>")).toBe(
      " Upcoming Milestones Potential FDA approval & launch ",
    );
  });
});

describe("how far away it is", () => {
  it("counts whole days to the event", () => {
    const now = new Date("2026-09-24T13:30:00.000Z");
    expect(daysUntil("2026-09-26", now)).toBe(2);
    expect(daysUntil("2026-11-14", now)).toBe(51);
    // A date already past reads as negative, never as "soon".
    expect(daysUntil("2026-09-20", now)).toBe(-4);
  });
});
