/**
 * model-schema.strict.test.ts — the submit_thesis schema stays compilable
 * into a grammar.
 *
 * The writer's submit_thesis tool runs in Anthropic strict mode: the wire
 * schema is compiled and the model's output is constrained to it. The
 * compiler rejects a documented set of keywords (`oneOf`, `minimum`,
 * `maxLength`, `pattern`, recursion, …) and a request that carries one
 * fails whole — the writer run dies before the model says a word. So the
 * schema is checked here through the SDK's OWN converter, the one that
 * builds the wire schema, and any unsupported keyword fails the suite.
 */
import { zodSchema } from "ai";
import { thesisDecisionSchema } from "@/lib/agent/thesis-research/decision";
import { findStrictViolations, modelTriggerSchema } from "./model-schema";

describe("submit_thesis input schema — strict-mode compatible", () => {
  it("carries no keyword the grammar compiler rejects", () => {
    const wire = zodSchema(thesisDecisionSchema).jsonSchema;
    expect(findStrictViolations(wire)).toEqual([]);
  });

  it("names every trigger kind the evaluator has, and nothing else", () => {
    const wire = zodSchema(modelTriggerSchema).jsonSchema as { properties: { predicate: { anyOf: Array<Record<string, unknown>> } } };
    const kinds = new Set<string>();
    const collect = (node: Record<string, unknown>) => {
      const props = node.properties as Record<string, { const?: string }> | undefined;
      if (props?.kind?.const) kinds.add(props.kind.const);
      for (const v of (node.anyOf as Array<Record<string, unknown>> | undefined) ?? []) collect(v);
      const items = (props?.predicates as { items?: Record<string, unknown> } | undefined)?.items;
      if (items) collect(items);
    };
    collect(wire.properties.predicate as unknown as Record<string, unknown>);
    expect([...kinds].sort()).toEqual(
      [
        "AND", "EARNINGS_BEAT", "EARNINGS_MISS", "EARNINGS_SINCE", "EARNINGS_WITHIN", "GAIN_FROM_ENTRY", "GAP_UP",
        "INSIDER_CLUSTER", "NEAR_SMA", "NEW_HIGH", "OR", "PCT_FROM_52W_HIGH", "PRICE_ABOVE", "PRICE_BELOW",
        "PRICE_MOVE_PCT", "REVIEW_CADENCE", "RSI", "RS_VS_SPY", "SEC_EVENT", "TRAILING_FROM_HIGH", "VOLUME_RATIO", "VS_SMA",
      ].sort(),
    );
    // The invented kind from 2026-09-25 is not among them — under strict
    // mode the model cannot emit it.
    expect(kinds.has("REVIEW_AFTER_DAYS")).toBe(false);
  });

  it("uses anyOf, not oneOf, for the predicate union", () => {
    const wire = JSON.stringify(zodSchema(thesisDecisionSchema).jsonSchema);
    expect(wire).not.toContain('"oneOf"');
    expect(wire).toContain('"anyOf"');
  });
});
