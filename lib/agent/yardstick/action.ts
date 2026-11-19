/**
 * The yardstick's action grade (docs/plans/AGENT_ENGINE.md, "The yardstick"):
 * a case's `expect` names what a right answer calls and what it must never
 * call, and a replayed run passes when its calls and text match. Moved here
 * from scripts/hero-case.ts so a saved run can be scored again without the
 * runner (scripts/yardstick-regrade.ts).
 */

export type Cond = "present" | "absent" | string | number | boolean | { lt?: number; gt?: number; regex?: string };
export interface Rule { tool: string; where?: Record<string, Cond> }
/** A read that ran for real (`execute`) returned every one of these paths, not empty. */
export interface ReadRule { tool: string; has: string[] }
export interface Expect { call?: Rule[]; never?: Rule[]; text?: { regex: string }; neverText?: { regex: string }; read?: ReadRule }

export interface Call { toolName: string; input: unknown }

/** Every value at a dot path; `*` steps into each element of an array; `$sum` adds the `score` of each child; `$count` is the number of children. */
export function valuesAt(obj: unknown, path: string): unknown[] {
  let current: unknown[] = [obj];
  for (const key of path.split(".")) {
    const next: unknown[] = [];
    for (const v of current) {
      if (v == null || typeof v !== "object") continue;
      if (key === "*") { if (Array.isArray(v)) next.push(...v); continue; }
      if (key === "$sum") {
        const dims = Object.values(v as Record<string, unknown>);
        next.push(dims.reduce<number>((s, d) => s + (typeof d === "object" && d != null && typeof (d as { score?: unknown }).score === "number" ? (d as { score: number }).score : 0), 0));
        continue;
      }
      if (key === "$count") {
        next.push(Array.isArray(v) ? v.length : Object.keys(v as Record<string, unknown>).length);
        continue;
      }
      if (Array.isArray(v)) continue;
      const got = (v as Record<string, unknown>)[key];
      if (got !== undefined) next.push(got);
    }
    current = next;
  }
  return current.filter((v) => v !== undefined && v !== null);
}

export function holds(input: unknown, path: string, cond: Cond): boolean {
  const found = valuesAt(input, path);
  if (cond === "present") return found.length > 0;
  if (cond === "absent") return found.length === 0;
  if (typeof cond === "object") {
    return found.some((v) =>
      (cond.lt === undefined || (typeof v === "number" && v < cond.lt)) &&
      (cond.gt === undefined || (typeof v === "number" && v > cond.gt)) &&
      (cond.regex === undefined || new RegExp(cond.regex, "i").test(String(v))),
    );
  }
  return found.some((v) => v === cond);
}

export function matches(call: Call, rule: Rule): boolean {
  if (call.toolName !== rule.tool) return false;
  return Object.entries(rule.where ?? {}).every(([path, cond]) => holds(call.input, path, cond));
}

export function score(ex: Expect | undefined, calls: Call[], text: string, reads: Array<{ toolName: string; output: unknown }> = []): { pass: boolean; why: string } {
  if (!ex) return { pass: true, why: "no expectation" };
  const why: string[] = [];
  if (ex.read) {
    const ran = reads.filter((r) => r.toolName === ex.read!.tool);
    if (ran.length === 0) why.push(`no ${ex.read.tool} read`);
    else if (!ran.some((r) => ex.read!.has.every((path) => holds(r.output, path, "present")))) {
      const last = ran[ran.length - 1].output;
      why.push(`${ex.read.tool} returned no ${ex.read.has.filter((path) => !holds(last, path, "present")).join(", ")}`);
    }
  }
  // A run's thesis edits with no note (old-shape.ts) are never what a call rule asks for: every update_thesis a case names carried one.
  const asked = calls.filter((c) => !(c.input as { noteless?: unknown } | null)?.noteless);
  if (ex.call?.length && !ex.call.some((r) => asked.some((c) => matches(c, r)))) why.push(`no ${ex.call.map((r) => r.tool).join(" / ")} as expected`);
  for (const r of ex.never ?? []) if (calls.some((c) => matches(c, r))) why.push(`made the ${r.tool} it must not`);
  if (ex.text && !new RegExp(ex.text.regex, "i").test(text)) why.push(`text lacks /${ex.text.regex}/`);
  if (ex.neverText && new RegExp(ex.neverText.regex, "i").test(text)) why.push(`text has /${ex.neverText.regex}/`);
  return { pass: why.length === 0, why: why.join("; ") };
}

