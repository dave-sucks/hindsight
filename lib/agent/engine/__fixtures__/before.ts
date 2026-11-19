/**
 * What the old builders sent on the engine fixtures, part by part
 * (./before-three-parts.golden.json, built at #1031's head before the three
 * parts): the proof that a part's words are the same, or changed only as the
 * plan says (../three-parts.engine.test.ts).
 */
import BEFORE from "./before-three-parts.golden.json";
import { byParts } from "@/lib/agent/run-requests";
import type { BuiltNewest, BuiltRequest } from "../types";

type Golden = { cases: Record<string, Record<string, number>>; texts: string[] };

/** The shared instruction files, by the ids the old builders gave them. */
const OLD_IDS: Record<string, string> = { "house-rules.md": "house_rules", "how-you-write.md": "how_you_write" };

/** A case's old parts: "instructions:analyst_brief" → its text. */
export function before(caseKey: string): Record<string, string> {
  const g = BEFORE as Golden;
  const c = g.cases[caseKey];
  if (!c) throw new Error(`no old case ${caseKey}`);
  return Object.fromEntries(Object.entries(c).map(([k, i]) => [k, g.texts[i]]));
}

/** A built request's parts the same way: "instructions:own" → its text. Throws when they don't add up. */
export function partsOf(b: BuiltRequest, newest?: BuiltNewest): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (parts: BuiltRequest["parts"], text: string) => {
    if (!parts.length) return;
    const cut = byParts(parts, text);
    if (!cut || cut.after) throw new Error("its parts don't add up to what it sent");
    const sent = parts.filter((p) => p.chars > 0);
    // Keyed as the old builders named the parts: the agent's own file is "own", a shared file its old id.
    const key = (p: (typeof sent)[number]) => (p.kind === "own" ? "own" : (OLD_IDS[p.id] ?? p.id));
    cut.parts.forEach((c, i) => (out[`${sent[i].where}:${key(sent[i])}`] = c.sections[0].text));
  };
  add(b.parts.filter((p) => p.where === "instructions"), b.instructions);
  add(b.parts.filter((p) => p.where === "message"), b.message);
  if (newest) add(newest.parts, newest.texts.join("\n\n"));
  return out;
}
