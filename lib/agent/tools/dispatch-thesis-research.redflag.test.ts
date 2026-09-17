/**
 * The red-flag line before a writer is dispatched (DAV-269): PRAX filed an
 * auditor change (4.01) on 2026-07-02 while on the watchlist.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { send: jest.fn() } }));
import { redFlagLine } from "./dispatch-thesis-research";

const prax = { tier: "RED", filedDate: "2026-07-02", form: "8-K", rootForm: "8-K", items: ["4.01", "9.01"], url: "https://www.sec.gov/prax" };

describe("redFlagLine", () => {
  it("names PRAX's auditor change with the date and the link", () => {
    expect(redFlagLine([prax, { ...prax, tier: "MATERIAL", items: ["5.02"] }])).toBe(
      "RED FLAG — a serious filing in the last 90 days: 8-K — auditor change (4.01) filed 2026-07-02 (https://www.sec.gov/prax). Read it before trusting the numbers; say in the thesis what it means.",
    );
  });
  it("is null when nothing serious was filed", () => {
    expect(redFlagLine([{ ...prax, tier: "MATERIAL", items: ["5.02"] }])).toBeNull();
  });
});
