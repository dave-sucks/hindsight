import { caseBullets } from "./case-bullets";

describe("caseBullets — a bull or bear case as the page draws it", () => {
  it("the Writer's shape: bullets with their citation", () => {
    const value = { bullets: [{ text: "Backlog of $176B converts at 17% margins.", citation: { url: "https://x.test/a", domain: "x.test" } }, { text: "Second point." }] };
    expect(caseBullets(value)).toEqual([
      { text: "Backlog of $176B converts at 17% margins.", citation: { url: "https://x.test/a", domain: "x.test" } },
      { text: "Second point." },
    ]);
  });

  it("older shapes: a bare paragraph, string bullets; blanks dropped", () => {
    expect(caseBullets("One paragraph.")).toEqual([{ text: "One paragraph." }]);
    expect(caseBullets({ bullets: ["a", "", "  b "] })).toEqual([{ text: "a" }, { text: "b" }]);
    expect(caseBullets({ bullets: [{ text: "" }, { nope: 1 }, null] })).toEqual([]);
  });

  it("nothing: null, a number, an empty string", () => {
    expect(caseBullets(null)).toEqual([]);
    expect(caseBullets(3)).toEqual([]);
    expect(caseBullets("  ")).toEqual([]);
  });
});
