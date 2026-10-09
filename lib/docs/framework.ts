/**
 * The numbers on /docs/framework, measured on the server from the code this
 * deploy runs. Each door's prompt is built from the same fixed sample input
 * prompt-size.test.ts pins (lib/agent/__fixtures__/sample-prompts.ts), and
 * its tool menu is measured the way that test measures it: every tool on the
 * door's list, description plus the JSON schema the SDK sends. Whether a door
 * carries the house rules is read off its prompt, not written down here. The
 * situation texts are the SITUATIONS table itself.
 *
 * Measured once per server instance; a deploy that changes a prompt changes
 * the page. If a build step throws, that number is left out and the page says
 * so, rather than the page failing.
 */

import { zodSchema } from "ai";
import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import { MODES, type AgentMode } from "@/lib/agent/modes";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { createResearchTools } from "@/lib/agent/tools";
import type { PromptName } from "@/lib/agent/tools/field-contract";
import type { FrameworkData, FrameworkDoor, FrameworkDoorId } from "./framework-content";
import { WRITER_TOOLS } from "./tools";

const DOORS: ReadonlyArray<{ id: FrameworkDoorId; mode: AgentMode; prompt: PromptName; runMode?: string }> = [
  { id: "morning", mode: "research-run", prompt: "daily", runMode: "MORNING_PLAN" },
  { id: "trigger", mode: "tactical", prompt: "tactical", runMode: "INTRADAY_TACTICAL" },
  { id: "chat", mode: "principal", prompt: "chat", runMode: "PRINCIPAL_CHAT" },
  { id: "discovery", mode: "discovery", prompt: "discovery", runMode: "DISCOVERY" },
  { id: "writer", mode: "thesis-writer", prompt: "writer" },
];

type ToolDef = { description?: string; inputSchema: unknown };

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

/** The tool menu a door sends with every request: its tools' descriptions and schemas, in characters. */
function toolMenu(mode: AgentMode, runMode: string): { names: string[]; chars: number } {
  const all = createResearchTools({ runId: "docs", userId: "u", accountId: "a", analystId: "an", runMode, runEnvironment: "PAPER" } as never) as unknown as Record<string, ToolDef>;
  const allow = MODES[mode].toolAllowlist ?? Object.keys(all);
  const names = allow.filter((n) => all[n]);
  const chars = names.reduce((sum, n) => sum + (all[n].description ?? "").length + JSON.stringify(zodSchema(all[n].inputSchema as never).jsonSchema).length, 0);
  return { names, chars };
}

function measure(): FrameworkData {
  const doors: FrameworkDoor[] = DOORS.map((d) => {
    const cfg = MODES[d.mode];
    const prompt = safe(() => SAMPLE_PROMPTS[d.prompt]());
    // The writer's data tools run in code before it writes; its model call
    // gets only web search and submit_thesis, so it has no menu to measure.
    const menu = d.runMode ? safe(() => toolMenu(d.mode, d.runMode!)) : null;
    return {
      id: d.id,
      model: cfg.model,
      maxSteps: cfg.maxSteps,
      promptChars: prompt?.length ?? null,
      houseRules: prompt != null ? prompt.includes(HOUSE_RULES) : null,
      tools: menu?.names ?? (d.id === "writer" ? [...WRITER_TOOLS] : []),
      toolChars: menu?.chars ?? null,
    };
  });
  const situations = (Object.keys(SITUATIONS) as SituationCode[]).map((code) => ({
    code,
    name: SITUATIONS[code].name,
    chars: SITUATIONS[code].guidance.length,
    // The opening of the text, for the page to quote.
    opening: SITUATIONS[code].guidance.replace(/`/g, "").split(/(?<=[.!?])\s+/)[0]?.slice(0, 220) ?? "",
  }));
  return { houseRulesChars: HOUSE_RULES.length, doors, situations };
}

let cached: FrameworkData | null = null;

export function buildFrameworkData(): FrameworkData {
  cached ??= measure();
  return cached;
}
