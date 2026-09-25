/**
 * model-schema.test.ts — the trigger shape the model reads names every kind
 * the evaluator has, and the writer's tool is not sent strict.
 *
 * Strict mode was the first design and the API refused it twice on
 * 2026-09-25 (119 optional parameters against a limit of 24; then 121
 * union-typed parameters against a limit of 16). See model-schema.ts.
 */
import { zodSchema } from "ai";
import { thesisDecisionSchema } from "@/lib/agent/thesis-research/decision";
import { makeSubmitThesisTool } from "@/lib/agent/run-thesis-writer";
import { modelTriggerSchema } from "./model-schema";
import { triggerSchema } from "./schema";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("the trigger shape the model reads", () => {
  it("names every trigger kind the evaluator has, and nothing else", () => {
    const wire = zodSchema(modelTriggerSchema).jsonSchema as { properties: { predicate: { anyOf: Array<Record<string, unknown>> } } };
    const leafKinds = (branches: Array<Record<string, unknown>>): string[] =>
      branches.flatMap((b) => {
        const props = b.properties as Record<string, { const?: string; enum?: string[]; items?: { anyOf?: Array<Record<string, unknown>> } }> | undefined;
        const kind = props?.kind;
        if (kind?.const) return [kind.const];
        if (kind?.enum) return kind.enum;
        return [];
      });
    const modelKinds = new Set(leafKinds(wire.properties.predicate.anyOf));
    // The server schema's discriminated union is the authority on what exists.
    const server = zodSchema(triggerSchema).jsonSchema as { properties: { predicate: Record<string, unknown> } };
    const serverKinds = new Set(
      JSON.stringify(server.properties.predicate).match(/"const":"([A-Z_0-9]+)"/g)?.map((m) => m.replace(/"const":"|"/g, "")) ?? [],
    );
    for (const k of ["AND", "OR"]) serverKinds.delete(k);
    modelKinds.delete("AND");
    modelKinds.delete("OR");
    expect([...modelKinds].sort()).toEqual([...serverKinds].sort());
  });

  it("the decision schema carries the typed triggers, not unknown", () => {
    const wire = JSON.stringify(zodSchema(thesisDecisionSchema).jsonSchema);
    expect(wire).toContain('"REVIEW_CADENCE"');
    expect(wire).not.toContain('"REVIEW_AFTER_DAYS"');
  });

  it("the writer's submit tool is not sent strict (the API refuses a strict schema this size)", () => {
    const t = makeSubmitThesisTool({
      validate: { analyst: { minConfidence: 70, setupIds: [] } } as never,
      check: async () => ({ thesisId: null, wouldSave: true, error: null, fixable: false }),
      onAccept: () => {}, onAttempt: () => 1, ticker: "TEST",
    }) as unknown as { strict?: boolean };
    expect(t.strict).toBeUndefined();
  });
});
