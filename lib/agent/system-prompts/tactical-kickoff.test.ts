/**
 * The trigger run's kickoff moved out of tactical-run.ts into one builder.
 * It must write exactly what the inline template wrote, for every mix of the
 * day's facts, and the case runner must be able to read a recorded kickoff
 * back without guessing.
 */
import { fireExtras, kickoffExtras, tacticalKickoff } from "@/lib/agent/system-prompts/tactical-kickoff";

/** The template as tactical-run.ts wrote it inline before the extraction (main at 1b99a4ec). */
function inlineKickoff(ticker: string, fireSentence: string, f: { firedContext?: string; windowLine?: string | null; coFired?: string[]; openOnStock: string }): string {
  const contextSuffix = f.firedContext ? ` ${f.firedContext}` : "";
  const coFiredSuffix = f.coFired?.length ? ` Also fired on the same pass: ${f.coFired.join("; ")} — one decision covers both.` : "";
  const windowSuffix = f.windowLine ? ` ${f.windowLine}` : "";
  return (
    `Tactical run on $${ticker}. ${fireSentence}.${contextSuffix}${windowSuffix}${coFiredSuffix}${f.openOnStock} ` +
    `Validate, decide, act if warranted, then close out via update_thesis. ` +
    `You are running unattended — no human will respond. Every turn must call a tool; ` +
    `text-only turns terminate the run as FAILED.`
  );
}

const MIXES = [
  { openOnStock: "" },
  { firedContext: "EPS $1.12 vs $0.98 expected (+14%).", openOnStock: "" },
  { windowLine: "The FDA date is 23 days out, inside the setup's 10–30 day window.", openOnStock: "" },
  { coFired: ["Sell if 12% below the high since we bought"], openOnStock: "" },
  { firedContext: "Reported 2026-10-06.", windowLine: "Window line.", coFired: ["A", "B"], openOnStock: " Open refusal: update_thesis on 10-05 was refused (no_live_price)." },
];

describe("the trigger run's kickoff", () => {
  it("writes what the inline template wrote, for every mix of the day's facts", () => {
    for (const m of MIXES) {
      const built = tacticalKickoff({
        ticker: "HPE",
        fireSentence: "Sell if below $50",
        extras: fireExtras({ firedContext: m.firedContext, windowLine: m.windowLine, coFired: m.coFired, openRefusals: m.openOnStock }),
      });
      expect(built).toBe(inlineKickoff("HPE", "Sell if below $50", m));
    }
  });

  it("reads a recorded kickoff's extras back, byte for byte", () => {
    for (const m of MIXES) {
      const recorded = inlineKickoff("NVDA", "Sell if 8% below the high since we bought", m);
      const extras = kickoffExtras(recorded, "NVDA", "Sell if 8% below the high since we bought");
      expect(extras).not.toBeNull();
      expect(tacticalKickoff({ ticker: "NVDA", fireSentence: "Sell if 8% below the high since we bought", extras: extras! })).toBe(recorded);
    }
  });

  it("refuses to guess when the recorded sentence is not the one given", () => {
    const recorded = inlineKickoff("DOCU", "Price below $67 — consider entry", { openOnStock: "" });
    expect(kickoffExtras(recorded, "DOCU", "Buy if below $67")).toBeNull();
    expect(kickoffExtras(recorded, "DOCU", "Price below $67 — consider entry")).toBe("");
  });
});
