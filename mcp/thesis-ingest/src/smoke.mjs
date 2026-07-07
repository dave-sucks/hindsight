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
  entry_price: 280,
  target_price: 360,
  stop_loss: 245,
  core_belief: "Custom-silicon plus networking compounds datacenter revenue past 2028.",
  key_assumptions: ["Hyperscaler AI capex stays high", "VMware margin holds near 90%"],
  invalidation_conditions: ["A flagship hyperscaler drops Broadcom", "AI-semi growth below 20% two quarters"],
  conviction: "HIGH",
  conviction_rationale: "Cleanest non-NVDA way to own AI-accelerator unit growth; VMware annuity is a margin floor.",
  variant_view: "Consensus underweights the custom-XPU ramp at a third hyperscaler by two quarters.",
  target_size_pct: 11,
};

const bad = { ...good, conviction: undefined, conviction_rationale: undefined, variant_view: undefined };

console.log("── valid payload ──");
console.log(await postThesis(good));
console.log("── invalid payload (missing conviction) ──");
console.log(await postThesis(bad));
