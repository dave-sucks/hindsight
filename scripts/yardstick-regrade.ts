/**
 * yardstick-regrade.ts — score saved replays again with today's grader and
 * today's case labels, with no model call (docs/plans/AGENT_ENGINE.md, "The
 * yardstick"). A grader or a label fixed after a run is fixed for that run
 * too.
 *
 *   npx tsx scripts/yardstick-regrade.ts <written.jsonl> <out.jsonl>
 *
 * Each run's inputs are the ones scripts/hero-case.ts saved beside it
 * (inputs/<case>.txt); --inputs-only writes them for runs saved before it did.
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { score, type Expect } from "@/lib/agent/yardstick/action";
import { grade } from "@/lib/agent/yardstick/grade";

const [written, out] = process.argv.slice(2);
if (!written || !out) throw new Error("usage: yardstick-regrade.ts <written.jsonl> <out.jsonl>");
const rows = readFileSync(written, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown> & { case: string; narration: string; calls: Array<{ tool: string; input: unknown }> });
const lines = rows.map((r) => {
  const c = JSON.parse(readFileSync(`scripts/hero-cases/${r.case}.json`, "utf8")) as { expect?: Expect; grade?: { playbooks?: string[] } };
  const saved = readFileSync(`${dirname(written)}/inputs/${r.case}.txt`, "utf8");
  // What the run's own live reads handed the model, saved with the run.
  const inputs = r.readShown ? `${saved}\n${JSON.stringify(r.readShown)}` : saved;
  const calls = r.calls.map((x) => ({ toolName: x.tool, input: x.input }));
  const verdict = score(c.expect, calls, r.narration ?? "");
  return JSON.stringify({ ...r, pass: verdict.pass, why: verdict.why, grades: grade({ calls, narration: r.narration ?? "" }, inputs, c.grade ?? {}) });
});
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${out}: ${lines.length} runs graded again`);
