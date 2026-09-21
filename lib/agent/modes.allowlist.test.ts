/**
 * modes.allowlist.test.ts — every tool a mode asks for must exist, and no
 * mode may ask for a signal-inbox tool.
 *
 * Why this file exists: the route builds a mode's tool set with
 *
 *     modeConfig.toolAllowlist.map(name => [name, allTools[name]])
 *                             .filter(([, v]) => v != null)
 *
 * — a name that no longer resolves is dropped in silence. That is also how
 * the opposite failure hid for months: `discover_signals_for_fence` and
 * `read_analyst_inbox_stats` stayed on the builder and editor allowlists after
 * routing was switched off in May 2026, returned zero every time, and the
 * prompts treated zero as a hard stop — so the builder refused every fence and
 * blamed "no coverage yet" (DAV-260 §2).
 *
 * `read_signals` and `read_artifact` are kept in the codebase on purpose
 * (principal's call, 2026-09-16) — registered, but on no mode. The other
 * three signal tools are deleted.
 *
 * On main, the "no signal tool" cases fail for eight modes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MODES, type AgentMode } from "@/lib/agent/modes";

/**
 * The registered tool names, read out of the source of `createResearchTools`.
 * Parsed rather than imported: the tool catalog pulls in the Prisma client,
 * which jest can't load. The route reads the same object, so these keys are
 * the keys an allowlist name has to hit.
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

const REGISTERED = registeredToolNames();
const MODE_NAMES = Object.keys(MODES) as AgentMode[];

/** Kept in the codebase, listed nowhere. */
const KEPT_UNLISTED = ["read_signals", "read_artifact"];
/** Deleted with the router they read from. */
const DELETED = [
  "discover_signals_for_fence",
  "read_analyst_inbox_stats",
  "list_monitors",
];
const SIGNAL_TOOLS = [...KEPT_UNLISTED, ...DELETED];

function allowlistOf(mode: AgentMode): readonly string[] {
  return (MODES[mode].toolAllowlist ?? []) as readonly string[];
}

describe("mode tool allowlists", () => {
  it("parsed a real tool catalog", () => {
    expect(MODE_NAMES.length).toBeGreaterThan(0);
    expect(REGISTERED.has("get_stock_data")).toBe(true);
  });

  it.each(MODE_NAMES)("%s names only tools that exist", (mode) => {
    const unresolved = allowlistOf(mode).filter((n) => !REGISTERED.has(n));
    expect(unresolved).toEqual([]);
  });

  it.each(MODE_NAMES)("%s asks for no signal-inbox tool", (mode) => {
    const named = allowlistOf(mode).filter((n) => SIGNAL_TOOLS.includes(n));
    expect(named).toEqual([]);
  });

  it("keeps read_signals and read_artifact registered", () => {
    expect(KEPT_UNLISTED.filter((n) => !REGISTERED.has(n))).toEqual([]);
  });

  it("no longer registers the deleted signal tools", () => {
    expect(DELETED.filter((n) => REGISTERED.has(n))).toEqual([]);
  });

  // With the inbox gone, the builder and editor seed and check a fence off the
  // live market. If both of these leave an allowlist, the prompt's "never a
  // ticker from training data" rule has no tool behind it.
  it.each(["builder", "editor"] as const)(
    "%s can reach real tickers off the live market",
    (mode) => {
      const list = allowlistOf(mode);
      expect(
        list.includes("get_market_movers") ||
          list.includes("get_earnings_calendar"),
      ).toBe(true);
      expect(list).toContain("get_stock_data");
    },
  );
});

describe("the retired pipeline stays retired", () => {
  const inngestRoute = readFileSync(
    join(process.cwd(), "app/api/inngest/route.ts"),
    "utf8",
  );

  it.each([
    "firmMarketSweep",
    "portfolioWatchlistMonitor",
    "domainMonitor",
    "signalRouter",
    "pipelineCleanup",
    "backfillSignalFingerprint",
  ])("%s is not served to Inngest", (fn) => {
    expect(inngestRoute).not.toMatch(new RegExp(`\\b${fn}\\b`));
  });

  it("the trigger evaluator no longer listens for app/signal.routed", () => {
    const evaluator = readFileSync(
      join(process.cwd(), "lib/inngest/functions/trigger-evaluator.ts"),
      "utf8",
    );
    expect(evaluator).not.toMatch(/event:\s*"app\/signal\.routed"/);
  });
});
