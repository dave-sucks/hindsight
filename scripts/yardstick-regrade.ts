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
import { caseRules } from "@/lib/agent/yardstick/case-rules";
import type { StoredContext } from "@/lib/agent/yardstick/context";
import type { AgentId } from "@/lib/agent/engine/types";

const [written, out] = process.argv.slice(2);
if (!written || !out) throw new Error("usage: yardstick-regrade.ts <written.jsonl> <out.jsonl>");
const rows = readFileSync(written, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown> & { case: string; agent?: string; narration: string; reply?: string; error?: string | null; notes?: Array<{ tickers: string[]; text: string; impact: string; effect: string }>; calls?: Array<{ tool: string; input: unknown }> });
const lines = rows.map((r) => {
  const c = JSON.parse(readFileSync(`scripts/hero-cases/${r.case}.json`, "utf8")) as { expect?: Expect; grade?: { playbooks?: string[] }; context?: StoredContext[]; messages: unknown[] };
  const saved = readFileSync(`${dirname(written)}/inputs/${r.case}.txt`, "utf8");
  // What the run's own live reads handed the model, saved with the run.
  const inputs = r.readShown ? `${saved}\n${JSON.stringify(r.readShown)}` : saved;
  const calls = (r.calls ?? []).map((x) => ({ toolName: x.tool, input: x.input }));
  // A one-call agent's text is its reply and its notes; a run whose call failed is not graded.
  const text = [r.narration ?? "", ...(r.notes ?? []).map((n) => n.text)].join("\n\n");
  const verdict = r.error ? { pass: false, why: r.error } : score(c.expect, calls, text);
  const grades = grade({ calls, narration: text }, inputs, c.grade ?? {});
  // The rules of the agent's own instructions (the Portfolio Manager's write-up is its last reply).
  const own = r.agent && !r.error ? caseRules(r.agent as AgentId, c, { calls, reply: r.reply ?? r.narration ?? "", notes: r.notes, shown: inputs }) : null;
  if (own) grades.rules = own.rules;
  if (own?.invented) grades.invented = own.invented;
  return JSON.stringify({ ...r, pass: verdict.pass, why: verdict.why, grades });
});
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${out}: ${lines.length} runs graded again`);
