/**
 * The playbooks the builder reads carry no stops, targets, sizes or shorts.
 *
 * The live PEAD Specialist's strategy (production, 2026-10-27) still says
 * "Stop at -8% from entry or a reversal candle with volume." — copied word
 * for word from the earnings-drift playbook, and wrong against the account's
 * 6% rules. The setups, the settings and the account own those numbers now;
 * a playbook that restates them hands every new analyst a strategy that
 * argues with its own sell rules.
 */

import { replayTool } from "@/lib/replay";
import { BUILDER_SYSTEM_PROMPT } from "@/lib/agent/modes";
import { editorConfigSchema as configSchema } from "@/lib/agent/tools/suggest-config";

const LIVE_PEAD_STOP = "Stop at -8% from entry or a reversal candle with volume.";

async function read(args: Record<string, unknown>) {
  const { result } = await replayTool("read-knowledge-library", "readKnowledgeLibrary", { args });
  return result.data as { index?: Array<{ id: string }>; content?: string };
}

it("the earnings-drift playbook no longer hands out the stop the live PEAD copied", async () => {
  const { content } = await read({ topic: "archetype", id: "EARNINGS_DRIFT" });
  expect(content).not.toContain(LIVE_PEAD_STOP);
  expect(content).toContain("Direction: Long");
  expect(content).toContain("long only");
});

it("a playbook says what it comes with: the setups, confidence, slots and fence suggest_config fills in", async () => {
  const { content } = await read({ topic: "archetype", id: "EARNINGS_DRIFT" });
  expect(content).toContain("setups: PEAD, EPISODIC_PIVOT, MA_PULLBACK (the first is the signature setup)");
  expect(content).toContain("confidence a buy needs: 60; stocks held at once: 6");
  expect(content).toContain("sectors: any; market cap: $200,000,000–any");
  expect(content).not.toContain("Universe hints");
});

it("no playbook restates a stop, target, size or short, and none needs options data or a same-day close", async () => {
  const { index } = await read({ topic: "archetype" });
  expect(index!.map((a) => a.id)).not.toEqual(expect.arrayContaining(["UNUSUAL_OPTIONS"]));
  expect(index!.map((a) => a.id)).not.toEqual(expect.arrayContaining(["INTRADAY_MOMENTUM_SCALPER"]));
  for (const { id } of index!) {
    const { content } = await read({ topic: "archetype", id });
    expect({ id, content }).toMatchObject({ content: expect.stringContaining("Direction: Long") });
    for (const said of [/\bStop\b/, /Target:/, /Position size/, /of portfolio/, /\bsize down\b/, /for shorts/, /flatten/, /Hold durations:.*Day/]) {
      expect({ id, said: said.source, found: said.test(content!) }).toMatchObject({ found: false });
    }
  }
});

it("the builder asks no direction and offers no paper-era sizes or stops", () => {
  for (const said of ["LONG / SHORT / BOTH", "$500 learning", "stop philosophy", "BUILDER CONFIG DEFAULTS", "DAY / SWING / POSITION"]) {
    expect({ said, found: BUILDER_SYSTEM_PROMPT.includes(said) }).toMatchObject({ found: false });
  }
});

it("a same-day hold no longer throws away the watchlist", () => {
  const cfg = configSchema.parse({
    name: "x", analystPrompt: "x", directionBias: "LONG", holdDurations: ["DAY"], sectors: [],
    minConfidence: 60, maxPositionSize: 5000, maxOpenPositions: 5, minMarketCapTier: "MID",
    watchlist: [{ symbol: "NVDA", reason: "named by the owner" }],
  });
  expect(cfg.watchlist).toEqual([{ symbol: "NVDA", reason: "named by the owner" }]);
});
