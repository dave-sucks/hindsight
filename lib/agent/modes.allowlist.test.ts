/**
 * modes.allowlist.test.ts — every tool a mode asks for must actually exist,
 * and no mode may ask for one of the retired signal tools.
 *
 * Why this file exists: the route builds a mode's tool set with
 *
 *     modeConfig.toolAllowlist.map(name => [name, allTools[name]])
 *                             .filter(([, v]) => v != null)
 *
 * — a name that no longer resolves is dropped in silence. Nothing failed, no
 * log line, the agent just quietly lost a capability. That is also how the
 * opposite failure hid for months: `discover_signals_for_fence` and
 * `read_analyst_inbox_stats` stayed on the builder and editor allowlists after
 * routing was switched off in May 2026, returned zero every time, and the
 * prompts treated zero as a hard stop — so the builder refused every fence and
 * blamed "no coverage yet" (DAV-260 §2).
 *
 * The second test below fails on main, where seven modes still name at least
 * one retired signal tool.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MODES, type AgentMode } from "@/lib/agent/modes";

/**
 * The registered tool names, read out of the source of `createResearchTools`.
 * We parse rather than import because the tool catalog pulls in the Prisma
 * client, which jest can't load. The route reads the same object, so the keys
 * here are the keys an allowlist name has to hit.
 */
function registeredToolNames(): Set<string> {
  const src = readFileSync(
    join(process.cwd(), "lib/agent/tools/index.ts"),
    "utf8",
  );
  const start = src.indexOf("const toolsBase = {");
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\n  };", start));
  const names = new Set<string>();
  for (const line of body.split("\n")) {
    const m = /^\s{4}([a-z0-9_]+):\s*\w+\(/.exec(line);
    if (m) names.add(m[1]);
  }
  // Layered in by the route after filtering — plain `tool()` calls rather
  // than defineTool factories, so they never appear in the registry.
  // app/api/agent/[mode]/route.ts adds these per mode.
  names.add("suggest_config");
  names.add("suggest_podcast_config");
  return names;
}

const ALL_TOOLS = registeredToolNames();

const MODE_NAMES = Object.keys(MODES) as AgentMode[];

/**
 * The signal-inbox tools, deleted 2026-09-15 with the pipeline that filled
 * them. If one of these comes back, it comes back with a producer.
 */
const RETIRED_SIGNAL_TOOLS = [
  "read_signals",
  "read_artifact",
  "discover_signals_for_fence",
  "read_analyst_inbox_stats",
  "list_monitors",
];

describe("mode tool allowlists", () => {
  it("has at least one mode to check", () => {
    expect(MODE_NAMES.length).toBeGreaterThan(0);
  });

  it.each(MODE_NAMES)("%s names only tools that exist", (mode) => {
    const allowlist = MODES[mode].toolAllowlist;
    if (!allowlist) return; // no allowlist = every tool, nothing to resolve
    const unresolved = allowlist.filter((name) => !ALL_TOOLS.has(name));
    expect(unresolved).toEqual([]);
  });

  it.each(MODE_NAMES)("%s asks for no retired signal tool", (mode) => {
    const allowlist = MODES[mode].toolAllowlist ?? [];
    const retired = allowlist.filter((name) =>
      RETIRED_SIGNAL_TOOLS.includes(name as string),
    );
    expect(retired).toEqual([]);
  });

  it("no retired signal tool is still registered in the catalog", () => {
    const stillThere = RETIRED_SIGNAL_TOOLS.filter((name) =>
      ALL_TOOLS.has(name),
    );
    expect(stillThere).toEqual([]);
  });

  // The builder and editor seed and check a fence against real names. With the
  // inbox gone, that has to come from a live market call — if both of these
  // leave an allowlist, the prompt's "never a ticker from training data" rule
  // has no tool behind it and the model has nothing honest to fall back on.
  it.each(["builder", "editor"] as const)(
    "%s can reach real tickers off the live market",
    (mode) => {
      const allowlist = (MODES[mode].toolAllowlist ?? []) as readonly string[];
      expect(
        allowlist.includes("get_market_movers") ||
          allowlist.includes("get_earnings_calendar"),
      ).toBe(true);
      // …and a way to check a candidate against the fence once it has one.
      expect(allowlist).toContain("get_stock_data");
    },
  );
});
