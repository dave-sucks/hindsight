// Smoke test for the MCP server's HTTP wrapper. Exercises postThesis() against
// a running ingest endpoint WITHOUT stdio/MCP. Usage:
//   HINDSIGHT_INGEST_URL=http://localhost:3000/api/intelligence/thesis-ingest \
//   THESIS_INGEST_SECRET=... node src/smoke.mjs
import { postThesis } from "./server.mjs";

const good = {
  analyst: "Secular Compounder",
  ticker: "AVGO",
  direction: "LONG",
  horizon: "COMPOUNDER",
  triggers: [
    { predicate: { watch: "price", is: "below", value: 280 }, action: "ENTER", rationale: "I buy the pullback to $280." },
    { predicate: { watch: "price", is: "below", value: 245, settings: { close: true } }, action: "STOP_WATCHING", rationale: "Below $245 the custom-silicon ramp is not showing up." },
  ],
  core_belief: "Custom-silicon plus networking compounds datacenter revenue past 2028.",
  key_assumptions: ["Hyperscaler AI capex stays high", "VMware margin holds near 90%"],
  invalidation_conditions: ["A flagship hyperscaler drops Broadcom", "AI-semi growth below 20% two quarters"],
  conviction: "HIGH",
  conviction_rationale: "Cleanest non-NVDA way to own AI-accelerator unit growth; VMware annuity is a margin floor.",
  variant_view: "Consensus underweights the custom-XPU ramp at a third hyperscaler by two quarters.",
};

const bad = { ...good, conviction: undefined, conviction_rationale: undefined, variant_view: undefined };

console.log("── valid payload ──");
console.log(await postThesis(good));
console.log("── invalid payload (missing conviction) ──");
console.log(await postThesis(bad));
