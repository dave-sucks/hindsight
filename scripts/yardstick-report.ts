/**
 * yardstick-report.ts — the yardstick's scores from graded replays
 * (scripts/hero-case.ts --written, lib/agent/yardstick/grade.ts), one row per
 * case, side by side for each run of the set.
 *
 *   npx tsx scripts/yardstick-report.ts <label>=<written.jsonl> [<label>=<written.jsonl> ...] [--json out.json]
 *
 * Each column is one version of the code (main, a PR). Per case: the action
 * right (the case's expect), the playbook right, prices not from what it was
 * shown, numbers from nowhere, the belief's problems, sale prices loosened,
 * and the rules of its own instructions it broke (lib/agent/yardstick/rules.ts),
 * summed over its runs. A case with no expect (the Market Reviewer, the
 * digest) has no action to be right about.
 */
import { readFileSync, writeFileSync } from "fs";
import type { Grades } from "@/lib/agent/yardstick/grade";

interface Row { case: string; agent?: string; hasExpect?: boolean; run: number; pass: boolean; error?: string | null; grades?: Grades }

export interface CaseScore {
  runs: number;
  actionRight: number;
  playbookRight: number | null;
  pricesSet: number;
  pricesOff: number;
  invented: number;
  inventedTokens: string[];
  beliefProblems: number | null;
  saleLoosened: number;
  /** Rules of its own instructions broken, summed, and by rule; null for an agent with none. */
  rules: { broken: number; byRule: Record<string, number> } | null;
  /** Runs whose call failed (no reply graded). */
  failed: number;
  /** The action has no expect to be graded on. */
  noAction: boolean;
}

function score(rows: Row[]): CaseScore {
  const graded = rows.filter((r) => r.grades);
  const playbooks = graded.filter((r) => r.grades!.playbook);
  const beliefs = graded.filter((r) => r.grades!.belief);
  return {
    runs: rows.length,
    actionRight: rows.filter((r) => r.pass).length,
    playbookRight: playbooks.length ? playbooks.filter((r) => r.grades!.playbook!.right).length : null,
    pricesSet: graded.reduce((n, r) => n + r.grades!.prices.set, 0),
    pricesOff: graded.reduce((n, r) => n + r.grades!.prices.offInputs.length, 0),
    invented: graded.reduce((n, r) => n + r.grades!.invented.length, 0),
    inventedTokens: [...new Set(graded.flatMap((r) => r.grades!.invented))].slice(0, 12),
    beliefProblems: beliefs.length ? beliefs.reduce((n, r) => n + r.grades!.belief!.problems.length, 0) : null,
    saleLoosened: graded.reduce((n, r) => n + r.grades!.saleLoosened.length, 0),
    rules: graded.some((r) => r.grades!.rules)
      ? {
          broken: graded.reduce((n, r) => n + (r.grades!.rules?.length ?? 0), 0),
          byRule: graded.flatMap((r) => r.grades!.rules ?? []).reduce<Record<string, number>>((m, b) => ({ ...m, [b.rule]: (m[b.rule] ?? 0) + 1 }), {}),
        }
      : null,
    failed: rows.filter((r) => r.error).length,
    noAction: rows.every((r) => r.hasExpect === false),
  };
}

function main() {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf("--json");
  const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;
  const sets = args.filter((a, i) => a.includes("=") && !(jsonAt >= 0 && i === jsonAt + 1)).map((a) => {
    const [label, path] = a.split("=");
    const rows = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
    return { label, rows };
  });
  const cases = [...new Set(sets.flatMap((s) => s.rows.map((r) => r.case)))].sort();
  const table: Record<string, Record<string, CaseScore>> = {};
  for (const c of cases) {
    table[c] = {};
    for (const s of sets) {
      const rows = s.rows.filter((r) => r.case === c);
      if (rows.length) table[c][s.label] = score(rows);
    }
  }
  const cell = (x: CaseScore | undefined) =>
    !x
      ? "—"
      : `${x.noAction ? `${x.runs} runs` : `act ${x.actionRight}/${x.runs}`}${x.failed ? ` · FAILED ${x.failed}` : ""}${x.playbookRight != null ? ` · pb ${x.playbookRight}/${x.runs}` : ""} · price-off ${x.pricesOff}/${x.pricesSet} · invented ${x.invented}${x.beliefProblems != null ? ` · belief ${x.beliefProblems}` : ""}${x.saleLoosened ? ` · LOOSENED ${x.saleLoosened}` : ""}${x.rules ? ` · rules ${x.rules.broken}${x.rules.broken ? ` (${Object.entries(x.rules.byRule).map(([k, v]) => `${k.split(".")[1]} ${v}`).join(", ")})` : ""}` : ""}`;
  console.log(`| Case | ${sets.map((s) => s.label).join(" | ")} |`);
  console.log(`|---|${sets.map(() => "---").join("|")}|`);
  for (const c of cases) console.log(`| ${c} | ${sets.map((s) => cell(table[c][s.label])).join(" | ")} |`);
  // The Portfolio Manager's instructions have no sentence against inventing a number (lib/agent/yardstick/rules.ts, INVENTED_QUOTES).
  if (sets.some((s) => s.rows.some((r) => r.agent === "portfolio_manager"))) console.log("\nThe Portfolio Manager's \"invented\" rests on no sentence of its instructions: reported, not a rule it was given.");
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(table, null, 2));
}

main();
