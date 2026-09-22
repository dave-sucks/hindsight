/**
 * modes.principal-chat.test.ts — the chat reads the filing on a dated-event
 * name, and every tool it is pointed at is one it can actually call
 * (DAV-302).
 *
 * The session that raised this, 2026-09-22 01:47–01:51, reviewing MIRM,
 * CYTK, BMRN, AGIO and PRAX — five biotechs whose theses are entirely
 * regulatory, one of them four days from a PDUFA:
 *
 *   get_theses [MIRM, CYTK, BMRN]  ·  get_stock_data ×3
 *   web_search "…FOP FDA PDUFA September 26 2026 approval status"
 *   web_search "…CANOPY-HCH-3 Phase 3 results"
 *   get_theses [AGIO, PRAX]        ·  get_stock_data ×2
 *
 * Nine calls, no filing. It was not the model being lazy: the prompt routed
 * `get_sec_filings` off "who took a stake this month" and off the approval
 * queue, and nothing told a review of a catalyst name to read the 8-K.
 */
import { MODES, PRINCIPAL_SYSTEM_PROMPT } from "./modes";

const ALLOWLIST = new Set(MODES["principal"].toolAllowlist ?? []);

describe("a dated-event name is reviewed against what the company filed", () => {
  it("the depth bar routes a review to get_sec_filings", () => {
    expect(PRINCIPAL_SYSTEM_PROMPT).toContain("get_sec_filings(ticker)");
    expect(PRINCIPAL_SYSTEM_PROMPT).toContain(
      "Read what the company actually filed before you conclude",
    );
  });

  it("it names the events that count, not just 'a catalyst'", () => {
    for (const event of [
      "FDA decision",
      "trial readout",
      "deal close",
      "court date",
      "guidance change",
    ]) {
      expect(PRINCIPAL_SYSTEM_PROMPT).toContain(event);
    }
  });

  it("it says why the filing beats the write-up", () => {
    expect(PRINCIPAL_SYSTEM_PROMPT).toContain("The 8-K is the primary record");
  });
});

// The QB's standing check, as a test: a prompt that names a tool the mode
// cannot call is worse than saying nothing — the model reaches for it, the
// call is dropped, and the run looks like it researched something it didn't.
// `get_insider_activity` is NOT on this allowlist, which is why the routing
// line above does not mention it.
describe("every tool the chat prompt names is one it can call", () => {
  /** Snake_case identifiers the prompt writes as a call: `some_tool(`. */
  const namedTools = [
    ...new Set([...PRINCIPAL_SYSTEM_PROMPT.matchAll(/`(\w+_\w+)\(/g)].map((m) => m[1])),
  ];

  it("routes to tools that exist", () => {
    for (const t of ["get_sec_filings", "get_stock_data", "get_theses", "run_screen"]) {
      expect(ALLOWLIST.has(t)).toBe(true);
    }
    expect(namedTools.length).toBeGreaterThan(5);
  });

  it("names no tool that is off the allowlist", () => {
    expect(namedTools.filter((n) => !ALLOWLIST.has(n))).toEqual([]);
  });

  // The ticket listed get_insider_activity among the tools the session
  // failed to call. It is not on this allowlist, so the routing line
  // deliberately does not mention it — pointing at a tool the mode cannot
  // call is worse than saying nothing: the model reaches for it, the call is
  // dropped, and the run looks like it researched something it did not.
  it("get_insider_activity is not on the chat's allowlist, and the prompt does not promise it", () => {
    expect(ALLOWLIST.has("get_insider_activity")).toBe(false);
    expect(PRINCIPAL_SYSTEM_PROMPT).not.toContain("get_insider_activity");
  });
});
