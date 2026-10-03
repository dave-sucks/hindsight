/**
 * field-contract.test.ts — the tools are held to the field contract.
 *
 * For every write tool, in every mode that offers it, the tool is built with
 * that mode's context and its real schema is read back through the SDK's
 * converter (the wire the model sees). Then:
 *   - every field has a row in the registry (a new field cannot ship
 *     unclassified);
 *   - a COMPUTED field is absent from a run's schema;
 *   - a CHOSEN field is a closed set on the wire;
 *   - every JUDGED field's rule is stated in that mode's prompt.
 * The prompts are built with the same sample inputs the prompt tests use.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { zodSchema } from "ai";
import * as tools from "@/lib/agent/tools";
import { MODES } from "@/lib/agent/modes";
import { SAMPLE_PROMPTS as PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { FIELD_CONTRACT, MODE_PROMPTS, RULES, WRITE_TOOL_EXPORTS, type FieldContract } from "./field-contract";

type JsonSchema = { properties?: Record<string, Record<string, unknown>>; required?: string[] };

const ctxFor = (runMode: string) => ({
  runId: "contract", userId: "u", accountId: "a", analystId: "an", runMode, runEnvironment: "PAPER" as const,
  groupId: (p: string) => p, minPositionSize: 3000, maxPositionSize: 10000, maxPositionTotal: 20000, maxOpenPositions: 6, minConfidence: 70,
});

function wireOf(toolName: string, runMode: string): JsonSchema {
  const factory = (tools as Record<string, unknown>)[WRITE_TOOL_EXPORTS[toolName]] as (c: unknown) => { inputSchema: unknown };
  expect(typeof factory).toBe("function");
  return zodSchema(factory(ctxFor(runMode)).inputSchema as never).jsonSchema as JsonSchema;
}

/** A closed set on the wire: enum, const, boolean, or a union of those (with null allowed). */
function isClosedSet(p: Record<string, unknown>): boolean {
  if (p.enum || p.const !== undefined || p.type === "boolean") return true;
  const branches = (p.anyOf ?? p.oneOf) as Array<Record<string, unknown>> | undefined;
  if (branches) return branches.every((b) => b.type === "null" || isClosedSet(b));
  if (Array.isArray(p.type)) return (p.type as string[]).every((t) => t === "boolean" || t === "null");
  return false;
}

const offered = (mode: string): string[] => {
  const list = (MODES as Record<string, { toolAllowlist?: readonly string[] }>)[mode]?.toolAllowlist ?? [];
  return Object.keys(WRITE_TOOL_EXPORTS).filter((t) => list.includes(t));
};

describe("the field contract — every field on every write tool, in every mode", () => {
  for (const { mode, runMode, prompt } of MODE_PROMPTS) {
    for (const toolName of offered(mode)) {
      describe(`${toolName} in ${mode}`, () => {
        const wire = wireOf(toolName, runMode);
        const props = wire.properties ?? {};
        const rows = new Map(FIELD_CONTRACT[toolName].map((r) => [r.field, r]));

        it("every field the model can pass has a row in the registry", () => {
          const missing = Object.keys(props).filter((k) => !rows.has(k));
          expect(missing).toEqual([]);
        });

        it("a COMPUTED field is not in a run's schema", () => {
          const leaked = [...rows.values()]
            .filter((r) => r.kind === "COMPUTED" && k(props, r.field) && !(r.principalOnly && runMode === "PRINCIPAL_CHAT"))
            .map((r) => r.field);
          expect(leaked).toEqual([]);
        });

        it("a CHOSEN field is a closed set on the wire", () => {
          const open = Object.keys(props).filter((f) => rows.get(f)?.kind === "CHOSEN" && !isClosedSet(props[f]));
          expect(open).toEqual([]);
        });

        it("every JUDGED field's rule is stated in this mode's prompt", () => {
          const text = PROMPTS[prompt]();
          const unstated = Object.keys(props)
            .map((f) => rows.get(f))
            .filter((r): r is FieldContract => r?.kind === "JUDGED" && r.rule != null)
            .map((r) => ({ field: r.field, rule: r.rule!, marker: RULES[r.rule!].markers[prompt] }))
            .filter(({ marker }) => marker != null && !text.includes(marker))
            .map(({ field, rule, marker }) => `${field}: ${rule} — the ${prompt} prompt does not say "${marker}"`);
          expect(unstated).toEqual([]);
        });
      });
    }
  }

  describe("submit_thesis in the writer", () => {
    it("every JUDGED field's rule is stated in the writer's prompt", () => {
      const text = PROMPTS.writer();
      const unstated = FIELD_CONTRACT.submit_thesis
        .filter((r) => r.kind === "JUDGED" && r.rule != null)
        .map((r) => ({ field: r.field, marker: RULES[r.rule!].markers.writer }))
        .filter(({ marker }) => marker != null && !text.includes(marker))
        .map(({ field, marker }) => `${field}: the writer prompt does not say "${marker}"`);
      expect(unstated).toEqual([]);
    });
  });

  it("a rule offered in a mode is stated in that mode's prompt — or the registry says it has no words", () => {
    // Every JUDGED rule with markers declares one for each prompt of a mode
    // that offers a tool carrying it. A rule with no markers (EVENT_DATE,
    // TRIGGER_SHAPE) is enforced by coercion, not by a refusal the model
    // must anticipate, and is exempt.
    const gaps: string[] = [];
    for (const { mode, prompt } of MODE_PROMPTS) {
      for (const toolName of offered(mode)) {
        for (const r of FIELD_CONTRACT[toolName]) {
          if (r.kind !== "JUDGED" || !r.rule) continue;
          const rule = RULES[r.rule];
          if (Object.keys(rule.markers).length === 0) continue;
          if (!rule.markers[prompt]) gaps.push(`${r.rule} via ${toolName}.${r.field} has no marker for the ${prompt} prompt`);
        }
      }
    }
    expect([...new Set(gaps)]).toEqual([]);
  });
});

function k(props: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(props, field);
}
