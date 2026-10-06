/**
 * voice-count.ts — does what the agents wrote follow lib/agent/voice.ts?
 *
 *   npx tsx scripts/voice-count.ts before.jsonl after.jsonl
 *
 * Reads the files hero-case.ts writes with --written and counts, per file:
 * notes written, their average length in words, and every place a note or
 * the narration uses words the rules forbid (tool and field names, codes,
 * describing the checking, "the principal", "this seat", the bracket).
 * A count, not a score: the PR prints both columns and the worst lines.
 */
import { readFileSync } from "fs";

const FORBIDDEN: Array<[string, RegExp]> = [
  ["tool name", /\b(place_trade|update_thesis|close_position|manage_position|record_thesis|record_run_summary|complete_run|get_[a-z_]+|dispatch_thesis_research)\b/g],
  ["code", /\b[A-Z]{2,}_[A-Z_]+\b|\b(ENTER|EXIT|REVIEW|TRIM)\b|\b(PEAD|PDUFA|RISK_ON)\b/g],
  ["bracket", /\[Belief unchanged|\[STRUCTURED|\[WEB:/g],
  ["checking", /\bvalidat\w*|\bpredicate\b|\bgates?\b|execution time|\bladder\b|re-ladder\w*|\boverrid\w*|close-out|false fire/gi],
  ["principal", /\bthe principal\b|\bthis seat\b/gi],
];

interface Run { case: string; run: number; narration: string; saved: Array<{ tool: string; field: string; text: string }>; invalid?: Array<{ tool: string; error: string }> }

function count(path: string) {
  const runs = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Run);
  const notes = runs.flatMap((r) => r.saved.filter((s) => !s.field.endsWith("reasoning")));
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const hits: Record<string, number> = Object.fromEntries(FORBIDDEN.map(([k]) => [k, 0]));
  const worst: Array<{ n: number; text: string }> = [];
  for (const text of [...runs.map((r) => r.narration), ...runs.flatMap((r) => r.saved.map((s) => s.text))]) {
    let n = 0;
    for (const [k, re] of FORBIDDEN) {
      const m = text.match(re)?.length ?? 0;
      hits[k] += m;
      n += m;
    }
    if (n > 0) worst.push({ n, text });
  }
  const allWords = runs.reduce((s, r) => s + words(r.narration) + r.saved.reduce((t, x) => t + words(x.text), 0), 0);
  return {
    runs: runs.length,
    notes: notes.length,
    avgNoteWords: notes.length ? Math.round(notes.reduce((s, n) => s + words(n.text), 0) / notes.length) : 0,
    per1000: allWords ? Math.round((Object.values(hits).reduce((a, b) => a + b, 0) / allWords) * 10000) / 10 : 0,
    hits,
    worst: worst.sort((a, b) => b.n - a.n).slice(0, 3),
    invalid: runs.flatMap((r) => (r.invalid ?? []).map((x) => `${r.case} run ${r.run}: ${x.tool} — ${x.error}`)),
  };
}

const [before, after] = process.argv.slice(2);
if (!before || !after) throw new Error("usage: voice-count.ts before.jsonl after.jsonl");
const a = count(before);
const b = count(after);
console.log(`| | Before | After |\n|---|---|---|`);
console.log(`| Runs | ${a.runs} | ${b.runs} |`);
console.log(`| Notes and reasons written | ${a.notes} | ${b.notes} |`);
console.log(`| Average note, words | ${a.avgNoteWords} | ${b.avgNoteWords} |`);
console.log(`| Forbidden words per 1,000 | ${a.per1000} | ${b.per1000} |`);
for (const [k] of FORBIDDEN) console.log(`| — ${k} | ${a.hits[k]} | ${b.hits[k]} |`);
console.log(`| Tool calls that failed the schema | ${a.invalid.length} | ${b.invalid.length} |`);
for (const [label, r] of [["Before", a], ["After", b]] as const) {
  if (r.invalid.length) console.log(`\n${label}, calls that failed the schema:\n${r.invalid.map((x) => `- ${x}`).join("\n")}`);
}
for (const [label, r] of [["Before", a], ["After", b]] as const) {
  console.log(`\n${label}, worst lines:`);
  for (const w of r.worst) console.log(`- (${w.n}) ${w.text.slice(0, 300)}${w.text.length > 300 ? "…" : ""}`);
}
