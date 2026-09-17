/**
 * discovery.test.ts — discovery by screens (DAV-255): the pool step is the
 * seat's screens, and the immediate-buy path (a second road to a proposal)
 * is gone from the prompt and the mode.
 */
import { buildDiscoverySystemPrompt } from "./discovery";
import { MODES } from "@/lib/agent/modes";

const prompt = buildDiscoverySystemPrompt({
  config: { name: "PEAD Specialist", sectors: [], minConfidence: 70, maxPositionSize: 14000 },
  analystId: "cmnhxpjio000004jvox6kl6c7",
  existingTickers: ["MU", "FIVE"],
});

describe("the discovery prompt", () => {
  it("Step 1 is the seat's screens, with the numbers", () => {
    expect(prompt).toContain("### Step 1 — Run your seat's screens, in parallel");
    expect(prompt).toContain("run_screen");
    expect(prompt).not.toContain("Read the discovery surfaces you subscribe to");
  });
  it("the immediate-buy exception is deleted; discovery cannot place a trade", () => {
    expect(prompt).not.toContain("IMMEDIATE-BUY");
    expect(prompt).not.toContain("wait_for_thesis_refresh");
    expect(prompt).toContain("You CANNOT call place_trade");
  });
  it("dispatch carries the screen row and the setup", () => {
    expect(prompt).toContain("`setup_id` and `screen_row`");
  });
});

describe("the discovery mode", () => {
  it("has run_screen and no trade tools", () => {
    const list = MODES.discovery.toolAllowlist ?? [];
    expect(list).toContain("run_screen");
    expect(list).not.toContain("place_trade");
    expect(list).not.toContain("wait_for_thesis_refresh");
  });
  it("the chat has run_screen too", () => {
    expect(MODES.principal.toolAllowlist ?? []).toContain("run_screen");
  });
});
