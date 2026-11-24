/**
 * parse-sections.test.ts — the source markers: read out in order, once each,
 * and taken out of the text.
 */

import { parseCitations, withoutCitationMarkers } from "./parse-sections";

describe("citation helpers", () => {
  it("parseCitations dedupes and preserves order", () => {
    const cites = parseCitations("a [STRUCTURED:x] b [WEB:https://e.com/1] c [STRUCTURED:x]");
    expect(cites).toEqual(["STRUCTURED:x", "WEB:https://e.com/1"]);
  });

  it("withoutCitationMarkers leaves the sentence whole", () => {
    expect(withoutCitationMarkers("Sells widgets [STRUCTURED:profile]; revenue repeats [WEB:https://e.com/x].")).toBe("Sells widgets; revenue repeats.");
  });
});
