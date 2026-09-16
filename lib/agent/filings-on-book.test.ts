/**
 * run-input.filings.test.ts — filings on the book this week (DAV-269), in
 * words, serious and material only; a failed read is said, never "none".
 * PRAX's real 2026-07-02 auditor change is the serious row.
 */
import { filingsOnBook } from "./filings-on-book";

const prax = { ticker: "PRAX", filedDate: "2026-07-02", tier: "RED", url: "https://www.sec.gov/prax", form: "8-K", rootForm: "8-K", items: ["4.01", "9.01"] };
const mu = { ticker: "MU", filedDate: "2026-08-26", tier: "MATERIAL", url: "https://www.sec.gov/mu", form: "8-K", rootForm: "8-K", items: ["5.02"] };
const routine = { ticker: "MU", filedDate: "2026-08-27", tier: "CONTEXT", url: "https://www.sec.gov/mu2", form: "8-K", rootForm: "8-K", items: ["7.01"] };

describe("filingsOnBook", () => {
  it("lists serious and material filings newest first, routine ones left out", () => {
    const out = filingsOnBook({ byTicker: new Map([["PRAX", [prax]], ["MU", [routine, mu]]]) });
    expect(out.recent).toEqual([
      { ticker: "MU", date: "2026-08-26", tier: "material", summary: "8-K — officer or director leaving or joining (5.02)", url: "https://www.sec.gov/mu" },
      { ticker: "PRAX", date: "2026-07-02", tier: "serious", summary: "8-K — auditor change (4.01)", url: "https://www.sec.gov/prax" },
    ]);
    expect(out.error).toBeUndefined();
  });
  it("keeps the reader's error so the run says EDGAR failed", () => {
    expect(filingsOnBook({ byTicker: new Map(), error: "EDGAR search returned 429" })).toEqual({ recent: [], error: "EDGAR search returned 429" });
  });
});
